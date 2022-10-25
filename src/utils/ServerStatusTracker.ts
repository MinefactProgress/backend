import * as minecraftUtil from "minecraft-server-util";

import { fetch } from "..";
import { AdminSetting } from "../entity/AdminSetting";
import { Colors, sendWebhook } from "./DiscordMessageSender";
import { DATABASES } from "./DatabaseConnector";
import Logger from "./Logger";
import { ServerStatus } from "../entity/ServerStatus";
import { getObjectDifferences } from "./JsonUtils";

const nycServerStatus = [
  "NewYorkCity",
  "BuildingServer1",
  "BuildingServer2",
  "BuildingServer3",
  "BuildingServer4",
  "BuildingServer5",
  "BuildingServer6",
  "BuildingServer7",
  "BuildingServer8",
  "NYCMap",
  "NYCLobby",
  "Hub1",
  "BTLobby",
];
const serversToPingRole = ["NewYorkCity", "BuildingServer1"];
let currentlyUpdating = false;
export const status = {};

export async function pingNetworkServers() {
  if (currentlyUpdating) return;

  currentlyUpdating = true;
  const time = new Date().getTime();
  const servers = await ServerStatus.find();
  await DATABASES.terrabungee.query(
    "SELECT * FROM `StaticInstances`",
    async (error, results, fields) => {
      if (error) {
        Logger.error(error);
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
            timeout: 1000 * 20,
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

        if (res.status === "rejected") {
          if (oldValue.online) {
            oldValue.online = false;
            oldValue.players = {
              online: 0,
              max: oldValue.players.max,
              sample: [],
            };
            savesNew.push(oldValue.save());
          }
          continue;
        }

        const newValue = {
          id: serverNames[i],
          address: results[i].Address,
          online: true,
          version: res.value.version,
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

export async function checkServerStatus() {
  const servers = JSON.parse(
    (await AdminSetting.findOne({ key: "ips" })).value
  );

  const keys = Object.keys(servers);
  const promises = [];
  for (const server of Object.values(servers)) {
    const ip = (server as string).replace(":", "/");

    promises.push(
      fetch(`https://api.minetools.eu/ping/${ip}`).then((res: any) =>
        res.json()
      )
    );
  }
  const responses = await Promise.allSettled(promises);

  let update = Object.keys(status).length === 0;
  for (let i = 0; i < keys.length; i++) {
    const res = responses[i];

    if (res.status === "rejected") {
      Logger.error(
        `Error occurred while requesting server status of ${keys[i]}! Reason: ${res.reason}`
      );
      continue;
    }

    const oldValue = status[keys[i]];
    const newValue = res.value.error
      ? !oldValue || !oldValue.online
        ? { online: false, timeout: false, last_updated: new Date() }
        : { online: false, timeout: true, last_updated: new Date() }
      : {
          online: true,
          version: res.value.version,
          players: {
            online: res.value.players.online,
            max: res.value.players.max,
            list: res.value.players.sample,
          },
          last_updated: new Date(),
        };

    if (oldValue) {
      // Compare Server Status
      if (
        newValue.online !== oldValue.online ||
        newValue.timeout !== oldValue.timeout
      ) {
        // Status changed
        update = true;
        Logger.info(
          `Server status of ${keys[i]} changed (${statusToString(
            oldValue
          )} --> ${statusToString(newValue)})`
        );

        // Send network log
        if (newValue.online && !oldValue.online && !oldValue.timeout) {
          // Status switched from offline to online
          sendWebhook("network_log", generateNetworkLogEmbed(keys[i], true));
        } else if (!newValue.online && oldValue.timeout) {
          // Status switched from timeout to offline
          sendWebhook("network_log", generateNetworkLogEmbed(keys[i], false));
        }
      }
      // Compare Server Version
      if (
        newValue.version &&
        oldValue.version &&
        newValue.version.name !== oldValue.version.name
      ) {
        // Version changed
        update = true;
        Logger.info(
          `Server version of ${keys[i]} changed (${oldValue.version.name} --> ${newValue.version.name})`
        );
      }
    }

    status[keys[i]] = newValue;
  }

  if (update && Object.keys(status).length > 0) {
    // Update server status embed
    Logger.info("Updating Server Status Embed");
    const body = {
      content: "",
      embeds: [
        {
          title: "Server Status",
          description: serverDataToString(),
          color: Colors.MineFact_Green,
          footer: {
            text: "MineFact Network",
            icon_url:
              "https://cdn.discordapp.com/avatars/422633274918174721/7e875a4ccb7e52097b571af1925b2dc1.png",
          },
        },
      ],
    };

    sendWebhook("network_status", body);
  }
}

export function serverDataToString() {
  let result = "";

  for (const server of Object.entries(status)) {
    const serverName: string = server[0];
    const serverStatus: any = server[1];
    result += `${
      serverStatus.online
        ? ":green_circle: "
        : serverStatus.timeout
        ? ":yellow_circle: "
        : ":red_circle: "
    }**${serverName}** ${
      serverStatus.version ? `(${serverStatus.version.name.split(" ")[1]})` : ""
    }\n`;
  }

  return result;
}

function statusToString(status: any) {
  if (status.online) {
    return "Online";
  }
  if (status.timeout) {
    return "Timeout";
  }
  return "Offline";
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
