import { NextFunction, Request, Response } from "express";
import { Request as ApiRequest } from "../entity/statistics/Request";
import { Statistic, createMissingDays } from "../entity/statistics/Statistic";

export const trackRequestStatistics = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  res.on("finish", async () => {
    const ip = req.header("x-forwarded-for") || req.socket.remoteAddress;
    const request = ApiRequest.create({
      timestamp: new Date(),
      ip: Array.isArray(ip) ? ip[0] : ip,
      statusCode: res.statusCode,
      method: req.method,
      path: req.path,
      url: req.url,
    });
    request.save();

    const date = new Date();
    let count = await Statistic.findOneBy({
      date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    });

    if (!count) {
      await createMissingDays();
      count = await Statistic.findOneBy({
        date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
      });
    }

    count.count++;
    count.save();
  });
  next();
};
