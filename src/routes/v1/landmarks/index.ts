import { Request, Response } from "express";

import * as dbCache from "../../../utils/cache/DatabaseCache";
import { Permissions } from "../../../routes";
import { allowed } from "../../../middleware/auth";
import { Landmark } from "../../../entity/Landmark";
import { checkJsonKeys } from "../../../utils/JsonUtils";
import Logger from "../../../utils/Logger";
import { validate } from "../../../utils/Validation";

export const get = (req: Request, res: Response) => {
  allowed({
    permission: Permissions.default,
    req,
    res,
    callback: () => {
      return res.send(
        dbCache
          .find(Landmark)
          .map((landmark: Landmark) => landmark.toJson({ newVersion: true }))
      );
    },
  });
};

export const post = (req: Request, res: Response) => {
  allowed({
    permission: Permissions.moderator,
    req,
    res,
    callback: () => {
      const checkKeys = checkJsonKeys(req.body, [
        "name",
        "blockID",
        "location",
      ]);

      if (checkKeys) return res.status(400).send(checkKeys);

      let landmark = dbCache.findOne(Landmark, { name: req.body.name });
      if (landmark) {
        return res
          .status(400)
          .send({ error: "A Landmark with this name already exists." });
      }

      landmark = Landmark.create({
        name: req.body.name,
        blockID: req.body.blockID,
        location: req.body.location,
      });

      return validate(res, landmark, {
        successMessage: "Landmark created successfully",
        updateCache: true,
        onSuccess: () =>
          Logger.info(`Created landmark #${landmark.id} (${landmark.name})`),
      });
    },
  });
};
