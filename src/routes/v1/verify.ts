import { Request, Response } from "express";
import { Verification } from "../../entity/Verification";
import { allowed } from "../../middleware/auth";
import { Permissions } from "../../routes";
import Logger from "../../utils/Logger";
import { validate } from "../../utils/Validation";
import * as dbCache from "../../utils/cache/DatabaseCache";
import { User } from "../../entity/User";

export const post = (req: Request, res: Response) => {
  allowed({
    permission: Permissions.event,
    req,
    res,
    callback: async () => {
      const { user } = req;

      if (user.mc_uuid) {
        return res.status(400).send({
          error: "You already linked your account to a minecraft account!",
        });
      }

      let verification = await Verification.findOneBy({
        user: { uid: user.uid },
      });

      if (verification) {
        return res.status(400).send({
          error: "Verification process already started!",
        });
      }

      verification = Verification.create({
        user,
      });

      return validate(res, verification, {
        successMessage: "Verification process started!",
        successData: ["code"],
        updateCache: true,
        onSuccess: () => {
          Logger.info(`${user.username} started the verification process`);
        },
      });
    },
  });
};

export const put = (req: Request, res: Response) => {
  allowed({
    permission: Permissions.admin,
    req,
    res,
    requiredArgs: { code: "string", uuid: "string" },
    callback: async () => {
      const { code, uuid } = req.body;
      const verification = await Verification.findOneBy({ code });

      if (!verification) {
        return res
          .status(400)
          .send({ error: "The verification code is invalid" });
      }

      const user = dbCache.findOne(User, { uid: verification.user.uid });
      user.mc_uuid = uuid;

      await validate(res, user, {
        successMessage:
          "Successfully linked your Minecraft Account with the Progress Website",
        successData: {
          uid: user.uid,
          mc_uuid: uuid,
        },
        updateCache: true,
        onSuccess: async () => {
          await verification.remove();
          Logger.info(`${user.username} linked with Minecraft Account ${uuid}`);
        },
      });
    },
  });
};
