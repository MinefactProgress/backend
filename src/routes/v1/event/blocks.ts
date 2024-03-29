import { Request, Response } from "express";
import { Block } from "../../../entity/Block";
import { allowed } from "../../../middleware/auth";
import { Permissions } from "../../../routes";

import * as dbCache from "../../../utils/cache/DatabaseCache";

export const get = (req: Request, res: Response) => {
  allowed({
    permission: Permissions.default,
    req,
    res,
    callback: () => {
      const blocksRaw = dbCache.find(Block, { eventBlock: true });

      const blocks = [];
      for (const block of blocksRaw) {
        blocks.push(block.toJson({ showLandmarks: false }));
      }
      res.send(blocks);
    },
  });
};
