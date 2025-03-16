"use strict";

import { Request, Response } from "express";

const { jsonMiddleware } = require("express-response-middleware");

export function generateResponse(body: any, req: Request, res: Response) {
  if (!body.forceNoFormat) {
    const isError = !res.statusCode.toString().startsWith("2");

    if (body.secret) body.secret = "****";
    if (body.password) body.password = "****";

    return {
      path: req.path,
      method: req.method,
      data: isError ? undefined : body,
      error: isError ? body.error : undefined,
    };
  } else {
    return body.data;
  }
}

export default jsonMiddleware(generateResponse);
