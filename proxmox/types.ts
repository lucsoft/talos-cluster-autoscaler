export enum NodeIPFetchingStrategy {
    QemuGuestAgentSingleIPv4 = "QemuGuestAgentSingleIPv4",
}

export type NodeSizes = 'small' | 'medium' | 'large' | 'xlarge';

export type NodeSize = {
    cpu: number;
    memory: number;
};

/**
 * We mark nodes as valid if they contain the pools "local" and "local-lvm".
 * Have at least 4GiB of memory and at least 2 CPU cores.
 */
export type CachedNode = {
    node: string;

    capacity: {
        cpu: number;
        memory: number;
    };

    allocated: {
        cpu: number;
        memory: number;
    };

    free: {
        cpu: number;
        memory: number;
    };

    pools: string[];
};

export type PVEResponse<T> = { data: T; };

export type PVENode = {
    node: string;
    status: 'unknown' | 'online' | 'offline';
    maxmem: number;
    maxcpu: number;
    maxdisk: number;
};

export type PVEStoragePool = {
    storage: string;
    type: string;
    content: string;
};

export type PVEStorageContent = {
    content: string;
    volid: string;
};

export type PVEInstance = {
    vmid: number;
    name: string;
    status: 'stopped' | 'running';
    cpus: number;
    maxmem: number;
    tags: string;
};

export type PVEQemuNetworkInterface = {
    result: {
        name: string;
        'hardware-address': string;
        'ip-addresses': {
            "ip-address-type": "ipv4" | "ipv6";
            prefix: number;
            "ip-address": string;
        }[];
    }[];
};