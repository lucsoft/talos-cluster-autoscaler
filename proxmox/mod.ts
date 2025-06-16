// deno-lint-ignore-file require-await
import { sumOf } from "@std/collections";
import { registerCacheReloader, registerNodeGroup } from "../base/mod.ts";
import { NodeGroupConfig } from "../base/types.ts";
import { fetchNodes as fetchNodesForDatacenter } from "./api.ts";
import { NodeSize, NodeSizes } from "./types.ts";

// const defaultDiskSize = 20 * 1024 * 1024 * 1024; // 20GiB (do you really need larger disks? use a zfs pool for larger disks lol)

const datacenters: string[] = [
    "default"
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

const templateVmSizesEntries = Object.entries(templateVMSizes) as [ NodeSizes, NodeSize ][];

const availabilityForEachSize: Record<NodeSizes, number> = {
    "small": 0,
    "medium": 0,
    "large": 0,
    "xlarge": 0
};

registerCacheReloader(async () => {
    const nodes = await fetchNodesForDatacenter();

    availabilityForEachSize.small = sumOf(nodes.map(nodes => {
        const usableCpu = nodes.capacity.cpu - nodes.allocated.cpu;
        const usableMemory = nodes.capacity.memory - nodes.allocated.memory;

        return Math.min(
            Math.floor(usableCpu / templateVMSizes.small.cpu),
            Math.floor(usableMemory / templateVMSizes.small.memory)
        );
    }), it => it);

    availabilityForEachSize.medium = sumOf(nodes.map(nodes => {
        const usableCpu = nodes.capacity.cpu - nodes.allocated.cpu;
        const usableMemory = nodes.capacity.memory - nodes.allocated.memory;

        return Math.min(
            Math.floor(usableCpu / templateVMSizes.medium.cpu),
            Math.floor(usableMemory / templateVMSizes.medium.memory)
        );
    }), it => it);

    availabilityForEachSize.large = sumOf(nodes.map(nodes => {
        const usableCpu = nodes.capacity.cpu - nodes.allocated.cpu;
        const usableMemory = nodes.capacity.memory - nodes.allocated.memory;

        return Math.min(
            Math.floor(usableCpu / templateVMSizes.large.cpu),
            Math.floor(usableMemory / templateVMSizes.large.memory)
        );
    }), it => it);

    availabilityForEachSize.xlarge = sumOf(nodes.map(nodes => {
        const usableCpu = nodes.capacity.cpu - nodes.allocated.cpu;
        const usableMemory = nodes.capacity.memory - nodes.allocated.memory;

        return Math.min(
            Math.floor(usableCpu / templateVMSizes.xlarge.cpu),
            Math.floor(usableMemory / templateVMSizes.xlarge.memory)
        );
    }), it => it);
});

for (const datacenter of datacenters) {
    const nodes = await fetchNodesForDatacenter();

    const nodePools = Array.from(new Set(nodes.flatMap(node => node.pools)));

    for (const pool of [ undefined, ...nodePools ]) {
        for (const [ name, size ] of templateVmSizesEntries) {
            const nodeGroupId = `proxmox-${datacenter}-${name}${pool ? `-${pool}` : ""}`;

            const config: NodeGroupConfig = {
                id: nodeGroupId,
                maxSize: availabilityForEachSize[ name ],
                template: {
                    cpu: size.cpu.toString(),
                    memory: size.memory.toString(),
                    ephemeralStorage: "19GiB", // Default disk size, can be overridden by the user
                    pods: "110", // Default pods, can be overridden by the user
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
                allocateNode: () => Promise.resolve(),
                fetchInstances: async () => {
                    config.maxSize = availabilityForEachSize[ name ];
                    return [];
                },
                fetchTalosApidIPAddress: () => Promise.resolve(""),
                removeNode: () => Promise.resolve(),
            });
        }
    }
}