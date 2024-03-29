import { Request, Response } from "express";
import { User } from "../../../../entity/User";
import { DEFAULT_SETTINGS, UserSetting } from "../../../../entity/UserSetting";
import { allowed } from "../../../../middleware/auth";
import { Permissions } from "../../../../routes";
import * as dbCache from "../../../../utils/cache/DatabaseCache";
import { parseToPrimitive } from "../../../../utils/JsonUtils";

export const post = (req: Request, res: Response) => {
  allowed({
    permission: Permissions.event,
    req,
    res,
    requiredArgs: {
      key: "string",
      value: "any",
    },
    callback: async () => {
      const id = parseInt(req.params.id);
      const user = dbCache.findOne(User, { uid: id });

      if (user.uid !== id && req.user.permission < Permissions.moderator) {
        return res.status(403).json({
          status: 403,
          message: "You may only change your own settings",
        });
      }
      if (!Object.keys(DEFAULT_SETTINGS).includes(req.body.key)) {
        return res.status(400).send({ error: "Invalid key" });
      }

      let setting = dbCache.findOne(UserSetting, {
        key: req.body.key,
        user,
      });

      const parsedValue = parseToPrimitive(req.body.value);

      if (setting) {
        if (DEFAULT_SETTINGS[req.body.key] === parsedValue) {
          await setting.remove();
          res.send(setting.toJson());
        } else {
          const ret = await dbCache.update(setting, {
            key: req.body.key,
            value: parsedValue.toString(),
            user,
          });
          res.send(ret);
        }
      } else {
        setting = UserSetting.create({
          key: req.body.key,
          value: parsedValue.toString(),
          user,
        });

        await setting.save();
        res.send(setting.toJson());
      }
      dbCache.reload(user);
      dbCache.reload(setting);
    },
  });
};
