import { sumOf } from "@std/collections";
import { CachedNode, PVEInstance, PVENode, PVEResponse, PVEStorageContent, PVEStoragePool } from "./types.ts";

const apiEndpoint = "https://192.168.0.2:8006";
const token = "103dbed5-4953-47ec-a26a-0897d899bc9c";
const user = "talos-autoscaler@pve";
const tokenId = "tas";
const pveApiToken = `PVEAPIToken=${user}!${tokenId}=${token}`;
const talosISO = "https://factory.talos.dev/image/ce4c980550dd2ab1b17bbf2b08801c7eb59418eafe8f279833297925d67c7515/v1.10.4/metal-amd64.iso";

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

        // Check if the iso file exists
        const isoFileName = "metal-amd64.iso";

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
            pools: storagePools.data.map(pool => pool.storage).filter(pool => ![ "local", "local-lvm" ].includes(pool))
        });
    }

    return cachedNodes;
}