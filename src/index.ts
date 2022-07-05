import "reflect-metadata";

import * as bodyParser from "body-parser";
import * as date from "./utils/TimeUtils";
import * as express from "express";
import * as jwt from "./utils/JsonWebToken";

import { BaseEntity, createConnection, getRepository } from "typeorm";
import { Request, Response } from "express";

import { AdminSetting } from "./entity/AdminSetting";
import { AdminSettings } from "./adminsettings";
import Logger from "./utils/Logger";
import { Routes } from "./routes";
import { Stats } from "./stats";
import { User } from "./entity/User";
import { v4 as uuidv4 } from "uuid";
import { validate } from "class-validator";

var cors = require("cors");
var helmet = require("helmet");
var fetch = require("node-fetch");
var axios = require("axios");

const port = process.env.PORT || 8081;

Logger.debug("Connecting to database...");
createConnection()
  .then(async (connection) => {
    Logger.debug("Connected to database");

    // create express app
    const app = express();
    app.use(bodyParser.json());
    app.use(helmet());
    app.use(cors());
    Logger.debug("Loaded middleware");

    // register express routes from defined application routes
    Logger.debug("Registering routes...");
    Routes.forEach((route) => {
      (app as any)[route.method](
        route.route,
        async (req: Request, res: Response, next: Function) => {
          try {
            Stats.total_requests++;
            let user = await User.findOne({
              apikey: req.body.key || req.query.key,
            });
            Logger.http(
              `${req.method} ${req.path}${user ? ` (${user.username})` : ""}`
            );
            if (route.permission > 0) {
              if (user === undefined) {
                res.send(generateError("Invalid or missing API-Key"));
                Logger.info("Requested with invalid API-Key");
                return;
              }
              if (user.permission < route.permission) {
                res.send(generateError("No permission"));
                Logger.info("Requested without Permission");
                return;
              }
            }
            const result = new (route.controller as any)()[route.action](
              req,
              res,
              next
            );
            if (result instanceof Promise) {
              result.then((result) =>
                result !== null && result !== undefined
                  ? res.send(result)
                  : undefined
              );
            } else if (result !== null && result !== undefined) {
              res.json(result);
            }
            Stats.successful_requests++;
          } catch (err) {
            Stats.errors++;
            Logger.error(err);
          }
        }
      );
    });
    app.get("*",(req:Request,res:Response) => {
      res.send(generateError("Cannot GET "+req.path))
    })
    Logger.debug("Registered routes");

    // Create root user
    let root = await User.findOne({ username: "root" });
    if (root === undefined) {
      Logger.debug("Creating root user...");
      await connection.manager.save(
        connection.manager.create(User, {
          email: "root@roo.com",
          username: "root",
          permission: 4,
          discord: "Root#1234",
          settings: "{}",
          about:
            "The Root user of the Website, only for development use. Please always use your right user.",
          image:
            "https://cdn.discordapp.com/attachments/714797791913705472/831352332163350603/2021-04-12_19.11.21.png",
          picture:
            "https://i.picsum.photos/id/568/200/300.jpg?hmac=vQmkZRQt1uS-LMo2VtIQ7fn08mmx8Fz3Yy3lql5wkzM",
          password: jwt.generateToken("Progress2022", jwt.secretInternal),
          apikey: generateUUID(),
        })
      );
      Logger.debug("Created root user");
    }

    // Set default admin settings
    let settings = await getRepository(AdminSetting).find();
    AdminSettings.forEach(async (setting) => {
      if (!settings.some((e) => e.key === setting.key)) {
        Logger.debug(`Creating default setting ${setting.key}`);
        const adminSetting = new AdminSetting();
        adminSetting.key = setting.key;
        adminSetting.value = JSON.stringify(setting.value);
        adminSetting.permission = setting.permission;
        await getRepository(AdminSetting).save(adminSetting);
      }
    });
    if (process.argv.slice(2)[0] === "--i") {
      Logger.info("Running with Intervalls");
      date.startIntervals();
    } else {
      Logger.info("Running without Intervalls");
    }
    // start express server
    app.listen(port);
    Logger.info(`Server started on port ${port}`);
  })
  .catch((error) => Logger.error(error));

export async function getValidation(
  object: BaseEntity,
  successMessage: string,
  successData?: any
) {
  const errors = await validate(object);

  if (errors.length > 0) {
    return generateError(Object.values(errors[0].constraints)[0]);
  }

  await object.save();

  return generateSuccess(successMessage, successData);
}

export function generateSuccess(message?: string, data?: object) {
  return { error: false, message: message, data };
}

export function generateError(message: string, error?: object) {
  return { error: true, message: message, stacktrace: error };
}

export function generateUUID() {
  return uuidv4();
}

export { fetch, axios, port };
