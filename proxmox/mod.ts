// deno-lint-ignore-file require-await
import { sumOf } from "@std/collections";
import { repeatUntilSuccess } from "../base/async-utils.ts";
import { Instance, InstanceStatus_InstanceState } from "../base/externalgrpc.ts";
import { registerCacheReloader, registerNodeGroup } from "../base/mod.ts";
import { NodeGroupConfig } from "../base/types.ts";
import { createVM, deleteVM, fetchNodes as fetchNodesForDatacenter, findPerfectNode, getIpFromNode, getVM, getVMsByNodeGroupId } from "./api.ts";
import { NodeSize, NodeSizes } from "./types.ts";

// const defaultDiskSize = 20 * 1024 * 1024 * 1024; // 20GiB (do you really need larger disks? use a zfs pool for larger disks lol)

const datacenters: string[] = [
    "zone1"
];


const templateVMSizes: Record<NodeSizes, NodeSize> = {
    "small": {
        cpu: 2,
        memory: 4 * 1024 * 1024, // 4GiB
    },
    "medium": {
        cpu: 4,
        memory: 8 * 1024 * 1024, // 8GiB
    },
    "large": {
        cpu: 8,
        memory: 16 * 1024 * 1024, // 16GiB
    },
    "xlarge": {
        cpu: 16,
        memory: 32 * 1024 * 1024, // 32GiB
    }
};

const templateVmSizesEntries: [ NodeSizes, NodeSize ][] = [ [ "small", templateVMSizes.small ] ]; // Object.entries(templateVMSizes) as [ NodeSizes, NodeSize ][];

const availabilityForEachSize: Record<NodeSizes, number> = {
    "small": 0,
    "medium": 0,
    "large": 0,
    "xlarge": 0
};

registerCacheReloader(async () => {
    const nodes = await fetchNodesForDatacenter();
    for (const [ sizeName, size ] of templateVmSizesEntries) {
        availabilityForEachSize[ sizeName ] = sumOf(
            nodes.map(node =>
                Math.min(
                    Math.floor(node.free.cpu / size.cpu),
                    Math.floor(node.free.memory / size.memory)
                )
            ),
            it => it
        );
    }
});

for (const datacenter of datacenters) {
    const nodes = await fetchNodesForDatacenter();

    const nodePools = Array.from(new Set(nodes.flatMap(node => node.pools)));

    for (const pool of [ undefined, ...nodePools ]) {
        for (const [ name, size ] of templateVmSizesEntries) {
            const nodeGroupId = `proxmox-${datacenter}-${name}${pool ? `-${pool}` : ""}`;
            const targetCount = await getVMsByNodeGroupId(nodeGroupId).then(vms => vms.filter(item => item.status === "running").length);
            const config: NodeGroupConfig = {
                id: nodeGroupId,
                maxSize: targetCount + availabilityForEachSize[ name ],
                talhelperNodeConfig: {
                    installDisk: "/dev/vda"
                },
                template: {
                    cpu: size.cpu.toString(),
                    memory: size.memory.toString(),
                    ephemeralStorage: "19Gi",
                    pods: "110",
                    labels: {
                        "topology.kubernetes.io/region": datacenter,
                        ...pool ? {
                            "proxmox.talos-autoscaler.lucsoft.de/pool": pool
                        } : {}
                    }
                }
            };

            registerNodeGroup({
                nodeGroupConfig: config,
                allocateNode: async (hostname) => {
                    const node = findPerfectNode(nodes, hostname, size, pool);
                    await createVM(hostname, size, node, nodeGroupId);
                    await repeatUntilSuccess(async () => {
                        await getIpFromNode(hostname);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    });
                },
                fetchInstances: async () => {
                    const instances = await getVMsByNodeGroupId(nodeGroupId).then(vms => vms.map((instance): Instance => ({
                        id: instance.name,
                        status: {
                            errorInfo: undefined,
                            instanceState: instance.status === "running" ? InstanceStatus_InstanceState.instanceRunning : InstanceStatus_InstanceState.unspecified
                        }
                    })));
                    config.maxSize = availabilityForEachSize[ name ] + instances.length;
                    return instances;
                },
                fetchTalosApidIPAddress: (nodeName) => getIpFromNode(nodeName),
                removeNode: async (hostname) => {
                    const { node, vm } = await getVM(hostname);
                    await deleteVM(node.node, vm.vmid);
                },
            });
        }
    }
}