import * as dbCache from "../../utils/cache/DatabaseCache";

import { Request, Response } from "express";

import { Permissions } from "../../routes";
import { allowed } from "../../middleware/auth";
import { Block } from "../../entity/Block";
import { District } from "../../entity/District";

export const get = async (req: Request, res: Response) => {
  allowed({
    permission: Permissions.default,
    req,
    res,
    callback: async () => {
      const blocks = dbCache.find(Block);
      if (!blocks) {
        return res.status(404).send({ error: "No blocks found" });
      }
      const result = [];

      for (const bl of blocks) {
        if (
          bl.area == null ||
          bl.area.length == 0 ||
          bl.area == undefined ||
          bl.area == "[]"
        )
          continue;

        if (
          req.query.district &&
          bl.district != parseInt(req.query.district.toString() || "")
        )
          continue;
        if (req.query.event) {
          if (!bl.eventBlock) continue;
        }
        // if (bl.uid < parseInt(req.query.min.toString() || "0")) continue;
        //if (bl.uid >= parseInt(req.query.max.toString() || "100")) continue;
        const area = JSON.parse(bl.area).map((a: number[]) => [a[1], a[0]]);
        area.push(area[0]);
        const b = { ...bl };
        b.area = undefined;
        b.builder = bl.builder;

        result.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [area],
          },
          properties: b,
          id: bl.uid,
        });
      }
      // GeoJSON
      return res.json({
        forceNoFormat: true,
        data: {
          type: "FeatureCollection",
          center: req.query.district
            ? (
                await dbCache
                  .findOne(District, { id: req.query.district })
                  .toJson()
              ).center
            : null,
          features: result,
        },
      });
    },
  });
};
