import { Instance } from "./externalgrpc.ts";

export interface TalhelperNodeConfig {
    hostname: string;
    ipAddress?: string;
    installDisk?: string;
    patches?: string[];
}

export interface TalhelperConfig {
    endpoint: string;
    nodes: TalhelperNodeConfig[];
}

export interface NodeGroupConfig {
    id: string;
    minSize?: number;
    maxSize: number;
    template: {
        cpu: string;
        memory: string;
        ephemeralStorage: string;
        pods?: string;
        labels?: Record<string, string>;
    };
    /**
     * defaults to true
     */
    manuallyNodeResource?: boolean;
    talhelperNodeConfig?: Partial<TalhelperNodeConfig>;
}


export interface ActionsForNodeGroup {
    nodeGroupConfig: NodeGroupConfig;
    fetchInstances(): Promise<Instance[]>;
    fetchTalosApidIPAddress(nodeName: string): Promise<string>;
    /**
     * When fails it returns an out of resource error.
     */
    allocateNode(nodeName: string): Promise<void>;

    /**
     * Remove the node on the cloud provider block until its completely removed.
     */
    removeNode(nodeName: string): Promise<void>;
}
