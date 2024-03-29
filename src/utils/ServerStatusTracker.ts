import * as minecraftUtil from "minecraft-server-util";

import { Colors, sendWebhook } from "./DiscordMessageSender";

import {
  connectToDatabase,
  DATABASES,
  DATABASE_NAMES,
} from "./DatabaseConnector";
import Logger from "./Logger";
import { ServerStatus } from "../entity/ServerStatus";
import { getObjectDifferences } from "./JsonUtils";
import { countNewerVersions } from "../components/McVersionFetch";

import * as dbCache from "../utils/cache/DatabaseCache";
import { AdminSetting } from "../entity/AdminSetting";

export const proxyStatus = {
  java: null,
  bedrock: null,
};
const nycServerMapping = {
  "NYC-1": "NewYorkCity",
  Building1NYC: "BuildingServer1",
  Building2NYC: "BuildingServer2",
  Building3NYC: "BuildingServer3",
  Building4NYC: "BuildingServer4",
  Building5NYC: "BuildingServer5",
  Building6NYC: "BuildingServer6",
  Building7NYC: "BuildingServer7",
  Building8NYC: "BuildingServer8",
  MapNYC: "MapNYC",
  LobbyNYC: "LobbyNYC",
  Hub1: "Hub1",
};
const serversToPingRole = ["NewYorkCity", "BuildingServer1"];
const serversOnTimeout = [];
let currentlyUpdating = false;

const TIMEOUT_COUNTER = 2;
const TIMEOUT = 20000;

export async function pingNetworkServers() {
  if (currentlyUpdating) return;

  let serverStatusChanged = await pingProxyServers();

  currentlyUpdating = true;
  const time = new Date().getTime();
  const servers = await ServerStatus.find();
  await DATABASES.terrabungee.query(
    "SELECT * FROM `StaticInstances`",
    async (error, results, fields) => {
      if (error) {
        Logger.error(error);

        // Reconnect on fatal error
        if (error.fatal) {
          connectToDatabase(DATABASE_NAMES.terrabungee);
        }
        return;
      }
      if (!results) {
        Logger.error(
          "Error occurred while getting data from StaticInstances table"
        );
        return;
      }
      const requests = [];
      for (const server of results) {
        const [ip, port] = server.Address.split(":");
        requests.push(
          minecraftUtil.status(ip, parseInt(port), {
            timeout: TIMEOUT,
            enableSRV: true,
          })
        );
      }
      const responses = await Promise.allSettled(requests);
      const serverNames = results.map((server: any) => server.Id);

      // Handle responses

      // Check for new servers to be saved
      const saves = [];
      for (let i = 0; i < serverNames.length; i++) {
        if (
          !servers.some((server: ServerStatus) => server.id === serverNames[i])
        ) {
          const server = new ServerStatus();
          server.id = serverNames[i];
          server.address = results[i].Address;
          saves.push(server.save());
          Logger.debug(
            `New Network Server found: ${server.id} (${server.address})`
          );
        }
      }
      await Promise.allSettled(saves);

      // Update server status
      const savesNew = [];
      for (let i = 0; i < serverNames.length; i++) {
        const res = responses[i];
        const oldValue = servers.find(
          (s: ServerStatus) => s.id === serverNames[i]
        );

        if (!oldValue) {
          Logger.debug(`Skipping server ${serverNames[i]}! No oldValue found`);
          continue;
        }

        if (res.status === "rejected") {
          // Server offline now
          if (Object.keys(nycServerMapping).includes(serverNames[i])) {
            const index = serversOnTimeout.findIndex(
              (s) => s.name === serverNames[i]
            );
            if (index >= 0) {
              if (serversOnTimeout[index].timeouts >= TIMEOUT_COUNTER) {
                // Timeout --> Offline
                serversOnTimeout.splice(index, 1);
                serverStatusChanged = true;
                sendWebhook(
                  "network_log",
                  generateNetworkLogEmbed(
                    nycServerMapping[serverNames[i]],
                    false
                  )
                );
              } else {
                // Timeout --> Timeout
                serversOnTimeout[index].timeouts++;
              }
            }
          }
          if (oldValue.online) {
            if (Object.keys(nycServerMapping).includes(serverNames[i])) {
              if (!serversOnTimeout.find((s) => s.name === serverNames[i])) {
                // Online --> Timeout
                serversOnTimeout.push({
                  name: serverNames[i],
                  timeouts: 1,
                });
                serverStatusChanged = true;
              }
            }
            oldValue.online = false;
            oldValue.players = {
              online: 0,
              max: oldValue.players.max,
              sample: [],
            };
            savesNew.push(oldValue.save());
          }
          continue;
        } else {
          // Server online now
          if (Object.keys(nycServerMapping).includes(serverNames[i])) {
            const index = serversOnTimeout.findIndex(
              (s) => s.name === serverNames[i]
            );
            if (index >= 0) {
              // Timeout --> Online
              serversOnTimeout.splice(index, 1);
              serverStatusChanged = true;
            } else if (!oldValue.online) {
              // Offline --> Online
              sendWebhook(
                "network_log",
                generateNetworkLogEmbed(nycServerMapping[serverNames[i]], true)
              );
            }
          }
        }
        if (Object.keys(nycServerMapping).includes(serverNames[i])) {
          if (!oldValue.online) {
            // Offline --> Online
            serverStatusChanged = true;
          }
        }

        const newValue = {
          id: serverNames[i],
          address: results[i].Address,
          online: true,
          version: /([a-zA-Z]\s\d\.\d\d\.\d)|(\d\.\d\d\.\d)/.test(
            res.value.version.name
          )
            ? res.value.version
            : { name: "Unknown", protocol: -1 },
          players: {
            online: res.value.players.online,
            max: res.value.players.max,
            sample: res.value.players.sample || [],
          },
          motd: res.value.motd,
          favicon: res.value.favicon,
          srvRecord: res.value.srvRecord,
        };

        const diff = getObjectDifferences(oldValue, newValue);
        for (const col of diff) {
          oldValue[col] = newValue[col];
        }
        if (diff.length > 0) {
          savesNew.push(oldValue.save());
        }
      }
      if (serverStatusChanged) {
        updateStatusEmbed(servers);
      }
      if (savesNew.length > 0) {
        await Promise.allSettled(savesNew);
        const successful = responses.filter(
          (res: any) => res.status === "fulfilled"
        ).length;
        Logger.info(
          `Updated the server status of ${
            savesNew.length
          } servers (${successful} Online | ${
            responses.length - successful
          } Offline) | ${new Date().getTime() - time}ms`
        );
      }
      currentlyUpdating = false;
    }
  );
}
async function pingProxyServers(): Promise<boolean> {
  const requests = [
    minecraftUtil.status("buildtheearth.net", 25565, {
      timeout: TIMEOUT,
      enableSRV: true,
    }),
    minecraftUtil.statusBedrock("bedrock.buildtheearth.net", 19132, {
      timeout: TIMEOUT,
      enableSRV: true,
    }),
  ];

  const responses = await Promise.allSettled(requests);
  const java = responses[0] as any;
  const bedrock = responses[1] as any;

  let updated = false;

  // Java Proxy
  if (java.status === "rejected") {
    if (!proxyStatus.java || proxyStatus.java.online) {
      updated = true;
    }
    proxyStatus.java = {
      online: false,
      last_updated: new Date(),
    };
  } else {
    // Read groups
    const groups = {};
    let counter = 0;
    for (const line of java.value.players.sample) {
      if (line.name.includes("§8[§b") && line.name.includes("§8]§7 are in ")) {
        const split = line.name
          .replace("§8[§b", "")
          .replace("§8]§7 are in", "")
          .split(" §");
        const players = parseInt(split[0]);
        const type = split[1].substring(1).replace(" ", "").toLowerCase();

        groups[type] = players;
        counter += players;
      }
    }
    groups["other"] = Math.max(java.value.players.online - counter, 0);

    if (!proxyStatus.java || !proxyStatus.java.online) {
      updated = true;
    }

    proxyStatus.java = {
      online: true,
      ip: {
        default: "buildtheearth.net:25565",
        fallback: "network.buildtheearth.net:25565",
      },
      version: {
        fullName: java.value.version.name,
        name: java.value.version.name.split(" ")[1],
        protocol: java.value.version.protocol,
        support: java.value.motd.clean
          .split("\n")[0]
          .split("|  ")[1]
          .replace("[", "")
          .replace("]", ""),
      },
      players: {
        total: java.value.players.online,
        max: java.value.players.max,
        groups: groups,
      },
      motd: {
        raw: java.value.motd.raw,
        clean: java.value.motd.clean,
        html: java.value.motd.html,
        serverNews: java.value.motd.clean
          .split("\n")[1]
          .replace("|||  ", "")
          .replace("  |||", ""),
        rows: java.value.motd.clean.split("\n"),
      },
      favicon: java.value.favicon,
      srvRecord: java.value.srvRecord,
      last_updated: new Date(),
    };
  }

  // Bedrock Proxy
  if (bedrock.status === "rejected") {
    if (!proxyStatus.bedrock || proxyStatus.bedrock.online) {
      updated = true;
    }
    proxyStatus.bedrock = {
      online: false,
      last_updated: new Date(),
    };
  } else {
    if (
      !proxyStatus.bedrock ||
      !proxyStatus.bedrock.online ||
      proxyStatus.bedrock?.version.name !== bedrock.value?.version.name
    ) {
      updated = true;
    }
    proxyStatus.bedrock = {
      online: true,
      ip: "bedrock.buildtheearth.net:19132",
      edition: bedrock.value.edition,
      version: bedrock.value.version,
      players: bedrock.value.players,
      motd: bedrock.value.motd,
      srvRecord: bedrock.value.srvRecord,
      last_updated: new Date(),
    };
  }

  return updated;
}

async function updateStatusEmbed(servers: ServerStatus[]) {
  Logger.info("Updating Server Status Embed");

  const serversToDisplay = JSON.parse(
    dbCache.findOne(AdminSetting, {
      key: "status_embed_servers",
    }).value
  );

  const nycServers = servers
    .filter((s: ServerStatus) => serversToDisplay.includes(s.id))
    .sort((s1: ServerStatus, s2: ServerStatus) => {
      const indexA = Object.keys(nycServerMapping).indexOf(s1.id);
      const indexB = Object.keys(nycServerMapping).indexOf(s2.id);
      return indexA - indexB;
    });
  let desc = "";

  // Proxies
  if (proxyStatus.java) {
    desc += `${
      proxyStatus.java.online ? ":green_circle: " : ":red_circle: "
    }**Java Proxy**\n`;
  }
  if (proxyStatus.bedrock) {
    const newerVersions = await countNewerVersions(
      "Bedrock",
      `v${proxyStatus.bedrock.version?.name}`
    );

    desc += `${
      proxyStatus.bedrock.online ? ":green_circle: " : ":red_circle: "
    }**Bedrock Proxy** ${
      proxyStatus.bedrock.version?.protocol
        ? `[${proxyStatus.bedrock.version?.name}${
            newerVersions > 0 ? ` \`↑ ${newerVersions}\`` : ""
          }]`
        : ""
    }\n`;
  }

  // NYC Servers
  for (const server of nycServers) {
    const version = server.version.name.split(" ")[1] || server.version.name;
    const newerVersions = await countNewerVersions("Java", version);
    desc += `${
      server.online
        ? ":green_circle: "
        : serversOnTimeout.find((s) => s.name === server.id)
        ? ":yellow_circle: "
        : ":red_circle: "
    }**${nycServerMapping[server.id]}** ${
      server.version.protocol > -1
        ? `[${version}${newerVersions > 0 ? ` \`↑ ${newerVersions}\`` : ``}]`
        : ""
    }\n`;
  }

  const body = {
    content: "",
    embeds: [
      {
        title: "NYC Server Status",
        description: desc,
        color: Colors.MineFact_Green,
        footer: {
          text: "BTE NewYorkCity",
          icon_url:
            "https://cdn.discordapp.com/attachments/519576567718871053/1035577973467779223/BTE_NYC_Logo.png",
        },
      },
    ],
  };

  sendWebhook("network_status", body);
}

function generateNetworkLogEmbed(server: string, online: boolean) {
  return {
    content:
      !online && serversToPingRole.includes(server)
        ? "<@&976842481884864623>"
        : "",
    embeds: [
      {
        title: `${online ? ":recycle:" : ":warning:"} Server ${
          online ? "Online" : "Offline"
        }`,
        description: `The server **${server}** is ${
          online ? "online again" : "offline"
        }`,
        color: online ? Colors.Green : Colors.Error,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
