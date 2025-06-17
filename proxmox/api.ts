import { sumOf } from "@std/collections";
import { CachedNode, NodeAllocationStrategy, NodeIPFetchingStrategy, NodeSize, PVEInstance, PVENode, PVEResponse, PVEStorageContent, PVEStoragePool } from "./types.ts";

const apiEndpoint = "https://192.168.0.2:8006";
const token = "103dbed5-4953-47ec-a26a-0897d899bc9c";
const user = "talos-autoscaler@pve";
const tokenId = "tas";
const pveApiToken = `PVEAPIToken=${user}!${tokenId}=${token}`;
const talosISO = "https://factory.talos.dev/image/ce4c980550dd2ab1b17bbf2b08801c7eb59418eafe8f279833297925d67c7515/v1.10.4/metal-amd64.iso";
const nodeIPFetchingStrategy: NodeIPFetchingStrategy = NodeIPFetchingStrategy.QemuGuestAgentSingleIPv4;
const nodeAllocationStrategy: NodeAllocationStrategy = NodeAllocationStrategy.MostFree;
const isoFileName = "metal-amd64.iso";
const defaultCPU = 'host';

const denylistForHardwareAddresses = [
    "00:00:00:00:00:00" // This is a common placeholder for unconfigured interfaces
];

export function findPerfectNode(nodes: CachedNode[], hostname: string, size: NodeSize, pool?: string): string {

    const possibleNodes = nodes
        .filter(node => node.free.cpu >= size.cpu && node.free.memory >= size.memory)
        .filter(node => pool ? node.pools.includes(pool) : true);

    if (nodeAllocationStrategy === NodeAllocationStrategy.MostFree) {
        possibleNodes.sort((a, b) => (b.free.cpu + b.free.memory) - (a.free.cpu + a.free.memory));
    }

    if (nodeAllocationStrategy === NodeAllocationStrategy.LeastFree) {
        possibleNodes.sort((a, b) => (a.free.cpu + a.free.memory) - (b.free.cpu + b.free.memory));
    }

    if (possibleNodes.length === 0) {
        throw new Error(`No suitable node found for hostname ${hostname} with size ${JSON.stringify(size)}.`);
    }

    return possibleNodes[ 0 ].node;
}

/**
 * Proxmox doesn't allow to create VMs in an atomic way, so we have to generate a random VMID.
 * Future code should check if the VMID is already in use and retry if it is.
 */
export function randomVMID() {
    return Math.floor(Math.random() * (1_000_000 - 100)) + 100;
}

export async function createVM(hostname: string, size: NodeSize, node: string, nodeGroupId: string) {
    await fetch(`${apiEndpoint}/api2/json/nodes/${node}/qemu`, {
        method: "POST",
        headers: {
            "Authorization": pveApiToken,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            vmid: randomVMID(),
            name: hostname,
            ostype: "l26",
            agent: '1',
            cores: size.cpu,
            cpu: defaultCPU,
            memory: Math.floor(size.memory / 1024), // Convert from bytes to MiB
            start: true,
            storage: "local-lvm",
            tags: nodeGroupId,
            net0: 'virtio,bridge=vmbr0,firewall=1',
            virtio0: 'local-lvm:20,iothread=on',
            sata0: `local:iso/${isoFileName},media=cdrom`,
        })
    }).then(response => response.json()).then(console.log);
}

export async function deleteVM(node: string, vmid: number) {
    await fetch(`${apiEndpoint}/api2/json/nodes/${node}/qemu/${vmid}`, {
        method: "DELETE",
        headers: {
            "Authorization": pveApiToken,
            "Content-Type": "application/json"
        }
    }).then(response => {
        if (!response.ok) {
            throw new Error(`Failed to delete VM ${vmid} on node ${node}: ${response.statusText}`);
        }
        return response.json();
    });
}

export async function getVMsByNodeGroupId(nodeGroupId: string): Promise<PVEInstance[]> {
    const nodes = await fetch(apiEndpoint + "/api2/json/nodes", {
        method: "GET",
        headers: {
            "Authorization": pveApiToken,
            "Content-Type": "application/json"
        }
    })
        .then<PVEResponse<PVENode[]>>(response => response.json());

    const instances: PVEInstance[] = [];

    for (const node of nodes.data) {
        const vms = await fetch(`${apiEndpoint}/api2/json/nodes/${node.node}/qemu`, {
            method: "GET",
            headers: {
                "Authorization": pveApiToken,
                "Content-Type": "application/json"
            }
        }).then<PVEResponse<PVEInstance[]>>(response => response.json());

        for (const vm of vms.data) {
            if (vm.status !== "running") {
                continue;
            }
            if (!vm.tags || vm.tags !== nodeGroupId) {
                continue;
            }
            instances.push(vm);
        }
    }

    return instances;
}

export async function getVM(hostname: string): Promise<{ vm: PVEInstance, node: PVENode; }> {
    const nodes = await fetch(apiEndpoint + "/api2/json/nodes", {
        method: "GET",
        headers: {
            "Authorization": pveApiToken,
            "Content-Type": "application/json"
        }
    })
        .then<PVEResponse<PVENode[]>>(response => response.json());
    for (const node of nodes.data) {
        const vms = await fetch(`${apiEndpoint}/api2/json/nodes/${node.node}/qemu`, {
            method: "GET",
            headers: {
                "Authorization": pveApiToken,
                "Content-Type": "application/json"
            }
        }).then<PVEResponse<PVEInstance[]>>(response => response.json());

        for (const vm of vms.data) {
            if (vm.status !== "running") {
                continue;
            }
            if (vm.name !== hostname) {
                continue;
            }
            return {
                node,
                vm
            };
        }
    }
    throw new Error(`VM with hostname ${hostname} not found.`);
}

export async function getIpFromNode(hostname: string): Promise<string> {
    if (nodeIPFetchingStrategy !== NodeIPFetchingStrategy.QemuGuestAgentSingleIPv4) {
        console.warn(`Node IP fetching strategy ${nodeIPFetchingStrategy} is not supported.`);
        throw new Error(`Unsupported node IP fetching strategy: ${nodeIPFetchingStrategy}`);
    }

    const { node, vm } = await getVM(hostname);

    const qemuNetworkInterfaces = await fetch(`${apiEndpoint}/api2/json/nodes/${node.node}/qemu/${vm.vmid}/agent/network-get-interfaces`, {
        method: "GET",
        headers: {
            "Authorization": pveApiToken,
            "Content-Type": "application/json"
        }
    }).then<PVEResponse<{ result: { name: string; 'ip-addresses': { "ip-address-type": "ipv4", prefix: number, "ip-address": string; }[]; 'hardware-address': string; }[]; }>>(response => response.json());

    const filteredHardwareAddress = qemuNetworkInterfaces.data.result.filter(iface => !denylistForHardwareAddresses.includes(iface[ 'hardware-address' ]));

    const filteredWithIps = filteredHardwareAddress.filter(iface => iface[ 'ip-addresses' ] && iface[ 'ip-addresses' ].length > 0);

    if (filteredWithIps.length === 0) {
        throw new Error(`No valid network interfaces found for VM ${vm.name} (${vm.vmid}) on node ${node}.`);
    }

    if (filteredWithIps.length > 1) {
        throw new Error(`Multiple valid network interfaces found for VM ${vm.name} (${vm.vmid}) on node ${node.node}. Currently single interface is supported.`);
    }

    const ipv4Address = filteredWithIps[ 0 ][ "ip-addresses" ].filter(ip => ip[ "ip-address-type" ] === "ipv4");

    if (ipv4Address.length === 0) {
        throw new Error(`No valid IPv4 address found for VM ${vm.name} (${vm.vmid}) on node ${node.node}.`);
    }

    if (ipv4Address.length > 1) {
        throw new Error(`Multiple valid IPv4 addresses found for VM ${vm.name} (${vm.vmid}) on node ${node.node}. Currently single IPv4 address is supported.`);
    }

    return ipv4Address[ 0 ][ "ip-address" ];
}

export async function fetchNodes(): Promise<CachedNode[]> {
    const cachedNodes: CachedNode[] = [];

    const nodes = await fetch(apiEndpoint + "/api2/json/nodes", {
        method: "GET",
        headers: {
            "Authorization": pveApiToken,
            "Content-Type": "application/json"
        }
    })
        .then<PVEResponse<PVENode[]>>(response => response.json());


    for (const node of nodes.data) {
        // Sanity check: check if minimum requirements are met
        if (node.status !== "online") {
            console.log(`Node ${node.node} is not online. Invalid node...`);
            continue;
        }

        if (node.maxmem < 4 * 1024 * 1024 * 1024) { // 4GiB
            console.log(`Node ${node.node} does not have enough memory. Invalid node...`);
            continue;
        }

        if (node.maxcpu <= 2) {
            console.log(`Node ${node.node} does not have enough CPU cores. Invalid node...`);
            continue;
        }

        // Check if the node has the required storage pools

        const storagePools = await fetch(`${apiEndpoint}/api2/json/nodes/${node.node}/storage`, {
            method: "GET",
            headers: {
                "Authorization": pveApiToken,
                "Content-Type": "application/json"
            }
        }).then<PVEResponse<PVEStoragePool[]>>(response => response.json());

        if (storagePools.data.length === 0) {
            console.log(`No storage pools found for node ${node.node}. Invalid node...`);
            continue;
        }

        if (!(storagePools.data.find(pool => pool.storage === "local") && storagePools.data.find(pool => pool.storage === "local-lvm"))) {
            console.log(`Node ${node.node} does not have the required storage pools "local" and "local-lvm". Invalid node...`);
            continue;
        }


        if (!storagePools.data.some(pool => pool.storage === "local" && pool.content.includes("iso"))) {
            console.log(`Node ${node.node} does not have the required storage pool "local" with iso content. Invalid node...`);
            continue;
        }

        const content = await fetch(`${apiEndpoint}/api2/json/nodes/${node.node}/storage/local/content`, {
            method: "GET",
            headers: {
                "Authorization": pveApiToken,
                "Content-Type": "application/json"
            }
        }).then<PVEResponse<PVEStorageContent[]>>(response => response.json());

        const isoExists = content.data.some(item => item.content === "iso" && item.volid === `local:iso/${isoFileName}`);

        if (!isoExists) {
            console.log(`ISO file ${isoFileName} does not exist on node ${node.node}. Downloading...`);

            // Sys.AccessNetwork
            await fetch(`${apiEndpoint}/api2/json/nodes/${node.node}/storage/local/download-url`, {
                method: "POST",
                headers: {
                    "Authorization": pveApiToken,
                },
                body: new URLSearchParams({
                    content: "iso",
                    url: talosISO,
                    filename: isoFileName
                })
            }).then(response => response.text()).then(data => console.log(data));
        }

        const vms = await fetch(`${apiEndpoint}/api2/json/nodes/${node.node}/qemu`, {
            method: "GET",
            headers: {
                "Authorization": pveApiToken,
                "Content-Type": "application/json"
            }
        }).then<PVEResponse<PVEInstance[]>>(response => response.json());

        const runningVms = vms.data.filter(vm => vm.status === "running");
        const allocatedCpu = sumOf(runningVms, data => data.cpus);
        const allocatedMemory = sumOf(runningVms, data => data.maxmem);

        cachedNodes.push({
            node: node.node,
            capacity: {
                cpu: node.maxcpu,
                memory: node.maxmem
            },
            allocated: {
                cpu: allocatedCpu,
                memory: allocatedMemory
            },
            free: {
                cpu: node.maxcpu - allocatedCpu,
                memory: node.maxmem - allocatedMemory
            },
            pools: storagePools.data.map(pool => pool.storage).filter(pool => ![ "local", "local-lvm" ].includes(pool))
        });
    }

    return cachedNodes;
}