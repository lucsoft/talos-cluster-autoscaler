// deno-lint-ignore-file require-await
import * as grpc from "@grpc/grpc-js";
import { ServerStatusResponse } from "@grpc/grpc-js/build/src/server-call.ts";
import { readFile } from "node:fs/promises";
import { $ } from "zx";
import { repeatUntilSuccess } from "./async-utils.ts";
import { CloudProviderServer, CloudProviderService, Instance, InstanceStatus, InstanceStatus_InstanceState, NodeGroup, NodeGroupAutoscalingOptionsRequest, NodeGroupAutoscalingOptionsResponse, NodeGroupDecreaseTargetSizeRequest, NodeGroupDecreaseTargetSizeResponse, NodeGroupDeleteNodesRequest, NodeGroupDeleteNodesResponse, NodeGroupForNodeRequest, NodeGroupForNodeResponse, NodeGroupIncreaseSizeRequest, NodeGroupIncreaseSizeResponse, NodeGroupNodesRequest, NodeGroupNodesResponse, NodeGroupsRequest, NodeGroupsResponse, NodeGroupTargetSizeRequest, NodeGroupTargetSizeResponse, NodeGroupTemplateNodeInfoRequest, NodeGroupTemplateNodeInfoResponse, PricingNodePriceRequest, PricingNodePriceResponse, PricingPodPriceRequest, PricingPodPriceResponse, RefreshRequest, RefreshResponse } from "./externalgrpc.ts";
import { getTalhelperConfig, overwriteNodesInTalhelperConfig } from "./talhelper-utils.ts";
import { ActionsForNodeGroup } from "./types.ts";

// Converts to a Promise-based API

export type ErrorOr<ResponseType> = { type: "error", error: grpc.ServerErrorResponse | ServerStatusResponse; } | { type: "response", response: ResponseType; };

export type handleUnaryCall<RequestType, ResponseType> = (request: RequestType, call: grpc.ServerUnaryCall<RequestType, ResponseType>) => Promise<ErrorOr<ResponseType>>;

export const StatusCodes = grpc.status;

export const MethodNotImplementedError = { type: "error", error: { code: StatusCodes.UNIMPLEMENTED } } as const;
export const namespace = "talos-cluster-autoscaler";
export function getNodeInfo(options: {
    hostname: string, cpu: string, ephemeralStorage: string, memory: string, pods: string, labels: Record<string, string>;
}) {
    const capacity = {
        cpu: {
            string: options.cpu
        },
        [ "ephemeral-storage" ]: {
            string: options.ephemeralStorage
        },
        memory: {
            string: options.memory
        },
        pods: {
            string: options.pods
        }
    };
    return {
        nodeInfo: {
            metadata: {
                name: options.hostname,
                labels: {
                    "kubernetes.io/hostname": options.hostname,
                    "kubernetes.io/os": "linux",
                    ...options.labels
                },
                annotations: {},
                finalizers: [],
                managedFields: [],
                ownerReferences: []
            },
            status: {
                capacity,
                allocatable: capacity,
                conditions: [
                    {
                        type: "Ready",
                        status: "True",
                        lastTransitionTime: {
                            nanos: 0,
                            seconds: 0
                        }
                    },
                    {
                        type: "NetworkUnavailable",
                        status: "False",
                        lastTransitionTime: {
                            nanos: 0,
                            seconds: 0
                        }
                    },
                    {
                        type: "OutOfDisk",
                        status: "False",
                        lastTransitionTime: {
                            nanos: 0,
                            seconds: 0
                        }
                    },
                    {
                        type: "MemoryPressure",
                        status: "False",
                        lastTransitionTime: {
                            nanos: 0,
                            seconds: 0
                        }
                    },
                    {
                        type: "DiskPressure",
                        status: "False",
                        lastTransitionTime: {
                            nanos: 0,
                            seconds: 0
                        }
                    }
                ],
                addresses: [],
                images: [],
                runtimeHandlers: [],
                volumesAttached: [],
                volumesInUse: [],
            },
            spec: {
                podCIDRs: [],
                taints: [],
                unschedulable: false,
                providerID: options.hostname
            }
        }
    } as NodeGroupTemplateNodeInfoResponse;
}

export interface CloudProviderApi {
    /** NodeGroups returns all node groups configured for this cloud provider. */
    nodeGroups: handleUnaryCall<NodeGroupsRequest, NodeGroupsResponse>;
    /**
     * NodeGroupForNode returns the node group for the given node.
     * The node group id is an empty string if the node should not
     * be processed by cluster autoscaler.
     */
    nodeGroupForNode: handleUnaryCall<NodeGroupForNodeRequest, NodeGroupForNodeResponse>;
    /**
     * PricingNodePrice returns a theoretical minimum price of running a node for
     * a given period of time on a perfectly matching machine.
     * Implementation optional: if unimplemented return error code 12 (for `Unimplemented`)
     */
    pricingNodePrice: handleUnaryCall<PricingNodePriceRequest, PricingNodePriceResponse>;
    /**
     * PricingPodPrice returns a theoretical minimum price of running a pod for a given
     * period of time on a perfectly matching machine.
     * Implementation optional: if unimplemented return error code 12 (for `Unimplemented`)
     */
    pricingPodPrice: handleUnaryCall<PricingPodPriceRequest, PricingPodPriceResponse>;
    // /** GPULabel returns the label added to nodes with GPU resource. */
    // gpuLabel: handleUnaryCall<GPULabelRequest, GPULabelResponse>;
    // /** GetAvailableGPUTypes return all available GPU types cloud provider supports. */
    // getAvailableGpuTypes: handleUnaryCall<GetAvailableGPUTypesRequest, GetAvailableGPUTypesResponse>;
    // /** Cleanup cleans up open resources before the cloud provider is destroyed, i.e. go routines etc. */
    // cleanup: handleUnaryCall<CleanupRequest, CleanupResponse>;
    /** Refresh is called before every main loop and can be used to dynamically update cloud provider state. */
    refresh: handleUnaryCall<RefreshRequest, RefreshResponse>;
    /**
     * NodeGroupTargetSize returns the current target size of the node group. It is possible
     * that the number of nodes in Kubernetes is different at the moment but should be equal
     * to the size of a node group once everything stabilizes (new nodes finish startup and
     * registration or removed nodes are deleted completely).
     */
    nodeGroupTargetSize: handleUnaryCall<NodeGroupTargetSizeRequest, NodeGroupTargetSizeResponse>;
    /**
     * NodeGroupIncreaseSize increases the size of the node group. To delete a node you need
     * to explicitly name it and use NodeGroupDeleteNodes. This function should wait until
     * node group size is updated.
     */
    nodeGroupIncreaseSize: handleUnaryCall<NodeGroupIncreaseSizeRequest, NodeGroupIncreaseSizeResponse>;
    /**
     * NodeGroupDeleteNodes deletes nodes from this node group (and also decreasing the size
     * of the node group with that). Error is returned either on failure or if the given node
     * doesn't belong to this node group. This function should wait until node group size is updated.
     */
    nodeGroupDeleteNodes: handleUnaryCall<NodeGroupDeleteNodesRequest, NodeGroupDeleteNodesResponse>;
    /**
     * NodeGroupDecreaseTargetSize decreases the target size of the node group. This function
     * doesn't permit to delete any existing node and can be used only to reduce the request
     * for new nodes that have not been yet fulfilled. Delta should be negative. It is assumed
     * that cloud provider will not delete the existing nodes if the size when there is an option
     * to just decrease the target.
     */
    nodeGroupDecreaseTargetSize: handleUnaryCall<NodeGroupDecreaseTargetSizeRequest, NodeGroupDecreaseTargetSizeResponse>;
    /** NodeGroupNodes returns a list of all nodes that belong to this node group. */
    nodeGroupNodes: handleUnaryCall<NodeGroupNodesRequest, NodeGroupNodesResponse>;
    /**
     * NodeGroupTemplateNodeInfo returns a structure of an empty (as if just started) node,
     * with all of the labels, capacity and allocatable information. This will be used in
     * scale-up simulations to predict what would a new node look like if a node group was expanded.
     * Implementation optional: if unimplemented return error code 12 (for `Unimplemented`)
     */
    nodeGroupTemplateNodeInfo: handleUnaryCall<NodeGroupTemplateNodeInfoRequest, NodeGroupTemplateNodeInfoResponse>;
    /**
     * GetOptions returns NodeGroupAutoscalingOptions that should be used for this particular
     * NodeGroup.
     * Implementation optional: if unimplemented return error code 12 (for `Unimplemented`)
     */
    nodeGroupGetOptions: handleUnaryCall<NodeGroupAutoscalingOptionsRequest, NodeGroupAutoscalingOptionsResponse>;
}


export const jobQueue: (() => Promise<void>)[] = [];

let jobQueueProcessing = false;

setInterval(() => {
    if (jobQueueProcessing) return;
    if (jobQueue.length === 0) return;

    const job = jobQueue.shift();
    if (!job) return;

    jobQueueProcessing = true;

    job()
        .catch(err => {
            console.error("[JOBS] Error in jobQueue:", err);
        })
        .finally(() => {
            jobQueueProcessing = false;
        });
}, 500);


export async function createCloudProviderServer(api: CloudProviderApi) {

    const server = new grpc.Server();

    const crt = await readFile("cert/tls.crt");
    const key = await readFile("cert/tls.key");

    function handleRequest<RequestType, ResponseType>(call: grpc.ServerUnaryCall<RequestType, ResponseType>, callback: grpc.sendUnaryData<ResponseType>, apiFunction: handleUnaryCall<RequestType, ResponseType>) {
        apiFunction(call.request, call)
            .then(result => {
                if (result.type === "error") {
                    callback(result.error);
                }
                else {
                    callback(null, result.response);
                }
            })
            .catch(err => {
                console.error("Internal error in handleRequest:", err);
                callback({
                    code: grpc.status.INTERNAL,
                    message: "Internal server error",
                    details: err.message,
                });
            });
    }

    const impl: CloudProviderServer =
    {
        nodeGroups(call, callback): void {
            handleRequest(call, callback, api.nodeGroups);
        },
        nodeGroupForNode(call, callback): void {
            handleRequest(call, callback, api.nodeGroupForNode);
        },
        pricingNodePrice(call, callback): void {
            handleRequest(call, callback, api.pricingNodePrice);
        },
        pricingPodPrice(call, callback): void {
            handleRequest(call, callback, api.pricingPodPrice);
        },
        gpuLabel(call, callback): void {
            // deno-lint-ignore require-await
            handleRequest(call, callback, async () => ({
                type: "response",
                response: {
                    label: namespace + "/gpu-node"
                }
            }));
        },
        getAvailableGpuTypes(call, callback): void {
            // deno-lint-ignore require-await
            handleRequest(call, callback, async () => ({
                type: "response",
                response: {
                    gpuTypes: {},
                }
            }));
        },
        cleanup(call, callback): void {
            // deno-lint-ignore require-await
            handleRequest(call, callback, async () => ({
                type: "response",
                response: {}
            }));
        },
        refresh(call, callback): void {
            handleRequest(call, callback, api.refresh);
        },
        nodeGroupTargetSize(call, callback): void {
            handleRequest(call, callback, api.nodeGroupTargetSize);
        },
        nodeGroupIncreaseSize(call, callback): void {
            handleRequest(call, callback, api.nodeGroupIncreaseSize);
        },
        nodeGroupDeleteNodes(call, callback): void {
            handleRequest(call, callback, api.nodeGroupDeleteNodes);
        },
        nodeGroupDecreaseTargetSize(call, callback): void {
            handleRequest(call, callback, api.nodeGroupDecreaseTargetSize);
        },
        nodeGroupNodes(call, callback): void {
            handleRequest(call, callback, api.nodeGroupNodes);
        },
        nodeGroupTemplateNodeInfo(call, callback): void {
            handleRequest(call, callback, api.nodeGroupTemplateNodeInfo);
        },
        nodeGroupGetOptions(call, callback): void {
            handleRequest(call, callback, api.nodeGroupGetOptions);
        }
    };
    server.addService(CloudProviderService, impl);
    server.bindAsync("0.0.0.0:8086", grpc.ServerCredentials.createSsl(null, [
        {
            cert_chain: crt,
            private_key: key
        }
    ], false), (err, port) => err ? console.error(err) : console.log(`Server running at 0.0.0.0:${port}`));
}

const nodeGroups: ActionsForNodeGroup[] = [];

let cachedInstanceStatus: Record<string, InstanceStatus> = {};

export function registerNodeGroup(nodeGroup: ActionsForNodeGroup) {
    nodeGroups.push(nodeGroup);
}

export function startService() {
    createCloudProviderServer({
        nodeGroups: async () => {
            return {
                type: "response",
                response: {
                    nodeGroups: nodeGroups.map((ng): NodeGroup => ({
                        id: ng.nodeGroupConfig.id,
                        debug: ng.nodeGroupConfig.id,
                        minSize: ng.nodeGroupConfig.minSize || 0,
                        maxSize: ng.nodeGroupConfig.maxSize
                    }))
                }
            };
        },
        nodeGroupForNode: async (req) => {
            const invalidResponse = {
                type: "response",
                response: {
                    nodeGroup: {
                        id: "",
                        debug: "",
                        maxSize: 0,
                        minSize: 0
                    }
                } as NodeGroupForNodeResponse
            } as const;

            if (!req.node) return invalidResponse;
            if (!req.node.providerID) return invalidResponse;
            if (!cachedInstanceStatus[ req.node.providerID ]) return invalidResponse;

            const ng = nodeGroups.find(ng => req.node!.providerID.startsWith("tca-" + ng.nodeGroupConfig.id + "-"));

            return {
                type: "response",
                response: {
                    nodeGroup: ng ? {
                        id: ng.nodeGroupConfig.id,
                        debug: ng.nodeGroupConfig.id,
                        minSize: ng.nodeGroupConfig.minSize || 0,
                        maxSize: ng.nodeGroupConfig.maxSize
                    } : invalidResponse.response.nodeGroup
                }
            };
        },
        refresh: async () => {
            cachedInstanceStatus = {};
            for (const nodeGroup of nodeGroups) {
                for (const instance of await nodeGroup.fetchInstances()) {
                    cachedInstanceStatus[ instance.id ] = instance.status!;
                }
            }

            return {
                type: "response",
                response: {

                }
            };
        },
        nodeGroupTargetSize: async (req) => {
            const config = nodeGroups.find(ng => ng.nodeGroupConfig.id === req.id);
            if (!config) {
                return MethodNotImplementedError;
            }
            return {
                type: "response",
                response: {
                    targetSize: Object.entries(cachedInstanceStatus)
                        .filter(([ name ]) => name.startsWith("tca-" + req.id))
                        .filter(([ _, status ]) => status.instanceState !== InstanceStatus_InstanceState.instanceDeleting).length,
                }
            };
        },
        nodeGroupIncreaseSize: async (req) => {
            const config = nodeGroups.find(ng => ng.nodeGroupConfig.id === req.id);

            if (!config) {
                return MethodNotImplementedError;
            }

            console.log("[TASK] Increasing size node group (" + req.id + ") by " + req.delta + " nodes...");


            for (let i = 0; i < req.delta; i++) {
                const nodeName = `tca-${req.id}-${crypto.randomUUID().split("-")[ 0 ]}`;

                try {
                    console.log("[DEPLOY] Allocating new node:", nodeName);

                    try {
                        await config.allocateNode(nodeName);
                    } catch (error) {
                        console.error("[DEPLOY] Error while allocating node:", error);
                        return {
                            type: "error",
                            error: {
                                code: StatusCodes.RESOURCE_EXHAUSTED,
                                message: "Failed to allocate node: " + (error instanceof Error ? error.message : "Unknown error")
                            }
                        };
                    }

                    const waitForNode = Promise.withResolvers<void>();
                    jobQueue.push(async () => {
                        try {
                            console.log("[DEPLOY] Deploying node:", nodeName);
                            const talhelperConfig = await getTalhelperConfig();
                            const inheritedTalhelperConfig = config.nodeGroupConfig.talhelperNodeConfig || {};
                            const ipAddress = await config.fetchTalosApidIPAddress(nodeName);
                            await overwriteNodesInTalhelperConfig(talhelperConfig, {
                                hostname: nodeName,
                                ipAddress: ipAddress,
                                ...inheritedTalhelperConfig
                            });
                            console.log("[DEPLOY] Prepared talhelper config for node:", nodeName, "with IP:", ipAddress);

                            await repeatUntilSuccess(async () => {
                                await $`talosctl get version -n ${ipAddress} -e ${ipAddress} --insecure`.quiet();
                            });

                            console.log("[DEPLOY] Talos is ready to accept config on node:", nodeName);

                            await $`talhelper gencommand apply --extra-flags --insecure  | bash`;

                            console.log("[DEPLOY] Talos config applied to node:", nodeName);

                            waitForNode.resolve();
                        } catch (error) {
                            console.error("Error while deploying node:", error);
                            waitForNode.reject(error);
                        }
                    });
                    await waitForNode.promise;
                }
                catch (error) {
                    console.error("Error while increasing node group size:", error);
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
            const config = nodeGroups.find(ng => ng.nodeGroupConfig.id === req.id);

            if (!config) {
                return MethodNotImplementedError;
            }

            console.log("[UNALLOCATE] Deleting nodes from node group: " + req.nodes.map(node => node.name).join(", ") + " (" + req.id + ")");

            for (const node of req.nodes) {
                const nodeName = node.name;
                if (!cachedInstanceStatus[ nodeName ])
                    continue; // Node is already being processed or does not exist

                const waitForNode = Promise.withResolvers<void>();
                jobQueue.push(async () => {
                    try {
                        const talhelperConfig = await getTalhelperConfig();
                        await overwriteNodesInTalhelperConfig(talhelperConfig, {
                            hostname: nodeName,
                            ipAddress: await config.fetchTalosApidIPAddress(nodeName),
                        });

                        await config.removeNode(nodeName);

                        await $`kubectl delete node ${nodeName}`.text();
                        waitForNode.resolve();
                    } catch (error) {
                        console.error("Error while removing node:", error);
                        waitForNode.reject(error);
                    }
                });
                await waitForNode.promise;
            }
            console.log("[UNALLOCATE] Nodes deleted successfully.");
            return {
                type: "response",
                response: {}
            };
        },
        nodeGroupDecreaseTargetSize: async () => {
            console.log("🚫 Decreasing target size for node group was called but was never implemented...");
            return MethodNotImplementedError;
        },
        nodeGroupNodes: async (req) => {
            const config = nodeGroups.find(ng => ng.nodeGroupConfig.id === req.id);

            if (!config) {
                return MethodNotImplementedError;
            }

            return {
                type: "response",
                response: {
                    instances: [
                        ...Object.entries(cachedInstanceStatus)
                            .filter(([ name ]) => name.startsWith("tca-" + req.id))
                            .map(([ name, status ]): Instance => ({
                                id: name,
                                status
                            }))
                    ]
                }
            };
        },

        nodeGroupTemplateNodeInfo: async (req) => {
            const config = nodeGroups.find(ng => ng.nodeGroupConfig.id === req.id);
            if (config) {
                return {
                    type: "response",
                    response: getNodeInfo({
                        hostname: `tca-${config.nodeGroupConfig.id}-${crypto.randomUUID().split("-")[ 0 ]}`,
                        cpu: config.nodeGroupConfig.template.cpu,
                        memory: config.nodeGroupConfig.template.memory,
                        ephemeralStorage: config.nodeGroupConfig.template.ephemeralStorage,
                        pods: config.nodeGroupConfig.template.pods || "110",
                        labels: config.nodeGroupConfig.template.labels || {}
                    })
                };
            }

            console.warn("Node group not found for templateNodeInfo:", req.id);

            return MethodNotImplementedError;
        },

        nodeGroupGetOptions: async (req) => {
            const config = nodeGroups.find(ng => ng.nodeGroupConfig.id === req.id);

            if (config) {
                return {
                    type: "response",
                    response: {
                        nodeGroupAutoscalingOptions: req.defaults
                    }
                };
            }

            console.warn("Node group not found for getOptions:", req.id);

            return MethodNotImplementedError;
        },

        // Maybe if somebody wants to implement this:
        pricingNodePrice: async () => {
            return MethodNotImplementedError;
        },
        pricingPodPrice: async () => {
            return MethodNotImplementedError;
        },
    });
}