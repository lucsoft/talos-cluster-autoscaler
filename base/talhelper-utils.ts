import * as yaml from "@std/yaml";
import { readFile, writeFile } from "node:fs/promises";
import { $ } from "zx";
import { TalhelperConfig, TalhelperNodeConfig } from "./types.ts";

export async function getTalhelperConfig(): Promise<TalhelperConfig> {
    const rawData = await readFile("talconfig.yaml", "utf-8");
    return yaml.parse(rawData) as TalhelperConfig;
}

export async function overwriteNodesInTalhelperConfig(config: TalhelperConfig, node: TalhelperNodeConfig) {
    config.nodes = [
        {
            installDisk: node.installDisk ?? "/dev/sda",
            ...node,
            patches: [
                yaml.stringify({
                    machine: {
                        kubelet: {
                            extraArgs: {
                                "provider-id": node.hostname
                            }
                        }
                    }
                }),
                ...(node.patches || [])
            ],
            hostname: node.hostname,
            ipAddress: node.ipAddress,
        }
    ];

    await writeFile("talconfig.yaml", yaml.stringify(config));
    await $`talhelper genconfig`;
}