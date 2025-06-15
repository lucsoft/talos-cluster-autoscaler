import { $ } from "zx";
import { repeatUntilFailure } from "../base/async-utils.ts";
import { Instance, InstanceStatus_InstanceState } from "../base/externalgrpc.ts";
import { registerNodeGroup, startService } from "../base/mod.ts";
import { getTalhelperConfig } from "../base/talhelper-utils.ts";

registerNodeGroup({
    nodeGroupConfig: {
        id: "docker",
        maxSize: 5,
        template: {
            // TODO: Use real values
            cpu: "10",
            memory: "14356112Ki",
            ephemeralStorage: "47171348Ki",
            pods: "110",
        }
    },
    fetchTalosApidIPAddress: async (nodeName: string) => (await $`docker inspect ${nodeName} --format='{{.NetworkSettings.IPAddress}}'`.text()).trim(),
    fetchInstances: async () => {
        const docker = await $`docker ps --format "{{.Names}}"`.text();
        const dockerNodes = docker.split("\n").filter(item => item.startsWith("tca-docker"));
        return dockerNodes.map((nodeName): Instance => ({
            id: nodeName,
            status: {
                errorInfo: undefined,
                // We just assume the node is running, as this is only for testing purposes.
                instanceState: InstanceStatus_InstanceState.instanceRunning
            }
        }));
    },
    allocateNode: async (nodeName: string) => {
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

    },
    removeNode: async (nodeName: string) => {
        const talhelperConfig = await getTalhelperConfig();
        const endpointIp = new URL(talhelperConfig.endpoint).hostname;

        // Stop the node by resetting it.
        await $`talosctl reset --talosconfig ./clusterconfig/talosconfig -e ${endpointIp} --wait=false`;

        await repeatUntilFailure(async () => {
            await $`docker inspect ${nodeName} --format='{{.State.Status}}'`.quiet();
            await new Promise(resolve => setTimeout(resolve, 1000));
        });
    }
});

startService();