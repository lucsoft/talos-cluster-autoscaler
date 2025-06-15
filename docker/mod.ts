// deno-lint-ignore-file require-await

import { writeFileSync } from "node:fs";
import { $ } from "zx";
import { Instance, InstanceStatus, InstanceStatus_InstanceState, NodeGroup } from "../base/externalgrpc.ts";
import { createCloudProviderServer, getNodeInfo, jobQueue, MethodNotImplementedError, StatusCodes } from "../base/mod.ts";
const currentNodesGroups: NodeGroup[] = [
    {
        debug: "Talos Docker Node Group",
        id: "tca-docker",
        minSize: 0,
        maxSize: 100
    }
];

// this is the state we should persist. Currently we hold it just in memory.
const instanceStatuses: Record<string, InstanceStatus> = {};

async function deployNode(hostname: string) {
    try {
        const resolvedIP = (await $`docker inspect ${hostname} --format='{{.NetworkSettings.IPAddress}}'`.text()).trim();

        const talconfig = `
clusterName: talos-default
talosVersion: v1.10.4
endpoint: https://127.0.0.1:52035
nodes:
  - hostname: ${hostname}
    ipAddress: ${resolvedIP}
    installDisk: "/dev/sda"
    patches:
    - |-
      machine:
        kubelet:
            extraArgs:
                provider-id: "externalgrpc://${hostname}"
`.trim();
        writeFileSync("talconfig.yaml", talconfig);

        await $`talhelper genconfig`;

        await $`until nc -vzw 2 ${resolvedIP} 50000; do sleep 2; done`;

        await $`talhelper gencommand apply --extra-flags --insecure  | bash`;

        console.log("Node setup successfully:", hostname);

        instanceStatuses[ hostname ] = {
            errorInfo: undefined,
            instanceState: InstanceStatus_InstanceState.instanceRunning
        };
    } catch (error) {
        instanceStatuses[ hostname ] = {
            errorInfo: error instanceof Error ? {
                errorCode: "DeploymentError",
                errorMessage: error.message,
                instanceErrorClass: 99
            } : {
                errorCode: "UnknownError",
                errorMessage: "An unknown error occurred while deploying the node.",
                instanceErrorClass: 99
            },
            instanceState: InstanceStatus_InstanceState.instanceCreating
        };
    }
}

async function removeNode(hostname: string) {
    try {
        const resolvedIP = (await $`docker inspect ${hostname} --format='{{.NetworkSettings.IPAddress}}'`.text()).trim();

        const talconfig = `
clusterName: talos-default
talosVersion: v1.10.4
endpoint: https://127.0.0.1:52035
nodes:
- hostname: ${hostname}
  ipAddress: ${resolvedIP}
  installDisk: "/dev/sda"
`.trim();
        writeFileSync("talconfig.yaml", talconfig);

        await $`talhelper genconfig`;
        await $`talosctl reset --talosconfig ./clusterconfig/talosconfig -e 10.5.0.2 --wait=false`;

        delete instanceStatuses[ hostname ];
    } catch (error) {
        instanceStatuses[ hostname ] = {
            errorInfo: error instanceof Error ? {
                errorCode: "DeploymentError",
                errorMessage: error.message,
                instanceErrorClass: 99
            } : {
                errorCode: "UnknownError",
                errorMessage: "An unknown error occurred while deploying the node.",
                instanceErrorClass: 99
            },
            instanceState: InstanceStatus_InstanceState.instanceCreating
        };
    }
}


createCloudProviderServer({
    nodeGroups: async () => {
        return {
            type: "response",
            response: {
                nodeGroups: currentNodesGroups
            }
        };
    },
    nodeGroupForNode: async (req) => {
        const invalidResponse = {
            type: "response",
            response: {
                nodeGroup: undefined
            }
        } as const;

        if (!req.node) return invalidResponse;
        if (!req.node.name.startsWith("tca-docker")) return invalidResponse;

        return {
            type: "response",
            response: {
                nodeGroup: currentNodesGroups[ 0 ]
            }
        };
    },
    refresh: async () => {
        // We should refresh our state here.
        return {
            type: "response",
            response: {

            }
        };
    },
    nodeGroupTargetSize: async (req) => {
        const docker = await $`docker ps --format "{{.Names}}"`.text();
        if (req.id !== "tca-docker") {
            return MethodNotImplementedError;
        }

        const dockerNodes = docker.split("\n").filter(item => item.startsWith("tca-docker")).length;

        return {
            type: "response",
            response: {
                targetSize: dockerNodes,
            }
        };
    },
    nodeGroupIncreaseSize: async (req) => {
        console.log("Increasing size for node group...");
        if (req.id !== "tca-docker") {
            return MethodNotImplementedError;
        }

        for (let i = 0; i < req.delta; i++) {
            const nodeName = `tca-docker-${crypto.randomUUID().split("-")[ 0 ]}`;

            try {
                await $`
                docker run --rm -d \
                    --name ${nodeName} \
                    --hostname ${nodeName} \
                    --read-only \
                    --privileged \
                    --security-opt seccomp=unconfined \
                    --mount type=tmpfs,destination=/run \
                    --mount type=tmpfs,destination=/system \
                    --mount type=tmpfs,destination=/tmp \
                    --mount type=volume,destination=/system/state \
                    --mount type=volume,destination=/var \
                    --mount type=volume,destination=/etc/cni \
                    --mount type=volume,destination=/etc/kubernetes \
                    --mount type=volume,destination=/usr/libexec/kubernetes \
                    --mount type=volume,destination=/usr/etc/udev \
                    --mount type=volume,destination=/opt \
                    -e PLATFORM=container \
                    ghcr.io/siderolabs/talos:v1.10.3
                `.text();

                console.log("Provisioned new node:", nodeName);
                instanceStatuses[ nodeName ] = {
                    errorInfo: undefined,
                    instanceState: InstanceStatus_InstanceState.instanceCreating
                };

                jobQueue.push(() => deployNode(nodeName));
            }
            catch (error) {

                return {
                    type: "error",
                    error: error instanceof Error ? {
                        code: StatusCodes.INTERNAL,
                        ...error
                    } : {
                        code: StatusCodes.INTERNAL,
                        message: "An unknown error occurred while increasing node group size."
                    }
                };
            }
        }

        return {
            type: "response",
            response: {}
        };
    },
    nodeGroupDeleteNodes: async (req) => {
        console.log("Deleting nodes from node group..." + req.nodes.map(node => node.name).join(", "));
        for (const node of req.nodes) {
            {
                const nodeName = node.name;
                if (instanceStatuses[ nodeName ])
                    continue; // Node is already being processed or does not exist

                instanceStatuses[ nodeName ] = {
                    errorInfo: undefined,
                    instanceState: InstanceStatus_InstanceState.instanceDeleting
                };
                jobQueue.push(() => removeNode(nodeName));
            }
        }
        return {
            type: "response",
            response: {}
        };
    },
    nodeGroupDecreaseTargetSize: async () => {
        console.log("Decreasing target size for node group...");
        // TODO: Implement this method
        return MethodNotImplementedError;
    },
    nodeGroupNodes: async (req) => {
        if (req.id !== "tca-docker") {
            return MethodNotImplementedError;
        }
        const docker = await $`docker ps --format "{{.Names}}"`.text();
        const dockerNodes = docker.split("\n").filter(item => item.startsWith("tca-docker"));

        return {
            type: "response",
            response: {
                instances: [
                    ...dockerNodes.map((name): Instance => ({
                        id: name,
                        status: instanceStatuses[ name ] ?? {
                            // Currently we assume the node is running, meaning it is currently not being created or deleted.
                            instanceState: InstanceStatus_InstanceState.instanceRunning
                        }
                    }))
                ]
            }
        };
    },

    // Optional methods that can be implemented later

    pricingNodePrice: async () => {
        return MethodNotImplementedError;
    },
    pricingPodPrice: async () => {
        return MethodNotImplementedError;
    },
    nodeGroupTemplateNodeInfo: async (req) => {
        if (req.id === "tca-docker") {
            return {
                type: "response",
                response: getNodeInfo({
                    hostname: `tca-docker-${crypto.randomUUID()}`,
                    cpu: "10",
                    memory: "14356112Ki",
                    ephemeralStorage: "47171348Ki",
                    pods: "110",
                    labels: {}
                })
            };
        }
        return MethodNotImplementedError;
    },
    nodeGroupGetOptions: async () => {
        return MethodNotImplementedError;
    }
});