import { getRepository } from "typeorm";
import { NextFunction, Request, Response } from "express";

import * as index from "../index";
import * as google from "../utils/SheetUtils";
import { statusToNumber } from "../utils/DistrictUtils";

import { Block } from "../entity/Block";
import { District } from "../entity/District";

export class DistrictController {
  private districtRepository = getRepository(District);

  async create(request: Request, response: Response, next: NextFunction) {
    if (request.body.name === undefined) {
      return index.generateError("Specify a name");
    }
    if (request.body.parent === undefined) {
      return index.generateError("Specify a parent");
    }

    let district = await this.districtRepository.findOne({
      name: request.body.name,
    });
    if (district !== undefined) {
      return index.generateError("District already exists");
    }

    let parent = await this.districtRepository.findOne({
      name: request.body.parent,
    });
    if (parent === undefined) {
      return index.generateError("Parent District not found");
    }

    district = new District();
    district.name = request.body.name;
    district.parent = parent.id;

    return index.getValidation(district, "District created");
  }

  async delete(request: Request, response: Response, next: NextFunction) {
    if (request.body.name === undefined) {
      return index.generateError("Specify a name");
    }
    if (request.body.name.toLowerCase() === "new york city") {
      return index.generateError("You cannot delete initial district");
    }
    let district = await this.districtRepository.findOne({
      name: request.body.name,
    });
    if (district === undefined) {
      return index.generateError("District not found");
    }

    let blocks = await Block.find({ district: district.id });

    if (blocks.length > 0) {
      return index.generateError("Cannot delete district with existing blocks");
    }

    await this.districtRepository.remove(district);
    return index.generateSuccess("District deleted");
  }

  async getAll(request: Request, response: Response, next: NextFunction) {
    const districts = await District.find();

    const array = [];
    for (const d of districts) {
      array.push(await d.toJson({ showDetails: false }));
    }

    return array;
  }

  async getOne(request: Request, response: Response, next: NextFunction) {
    let district = await this.districtRepository.findOne({
      name: request.params.name,
    });

    if (district === undefined) {
      return index.generateError("District not found");
    }

    return await district.toJson();
  }

  async import(request: Request, response: Response, next: NextFunction) {
    const blocks = request.query.blocks;
    const getData = await google.googleSheets.spreadsheets.values.get({
      auth: google.authGoogle,
      spreadsheetId: google.sheetID,
      range: `New York City (Overview)!A5:H`,
    });
    const data = getData.data.values;
    var districtCounter = 0;
    var blocksCounter = 0;

    this.districtRepository.clear();
    this.districtRepository.query("ALTER TABLE districts AUTO_INCREMENT = 1");

    if (blocks) {
      Block.clear();
      Block.query("ALTER TABLE blocks AUTO_INCREMENT = 1");
    }

    const boroughs = [];
    var isBorough = true;
    var currentParent = null;
    var boroughCounter = -1;
    for (const d of data) {
      if (d[1] === undefined || d[1] === null || d[1] === "") {
        isBorough = false;
        boroughCounter++;
        continue;
      }

      let district = new District();
      district.name = d[1];
      district.status = statusToNumber(d[2]);
      district.blocksDone = parseInt(d[3]);
      district.blocksLeft = parseInt(d[4]);
      district.progress = parseFloat(d[5].replace("%", "").replace(",", "."));

      if (isBorough) {
        district.parent = currentParent;
      } else {
        if (d[0] === "P") {
          district.parent = boroughs[boroughCounter];
        } else {
          district.parent = currentParent;
        }
      }

      const dateSplit = d[6].split(".");
      if (dateSplit.length === 3) {
        district.completionDate = new Date(
          `${dateSplit[2]}-${dateSplit[1]}-${dateSplit[0]}`
        );
      } else {
        district.completionDate = null;
      }

      let parent = await this.districtRepository.save(district);

      if (d[0] === "P") {
        currentParent = parent.id;
      } else {
        if (isBorough) {
          boroughs.push(parent.id);
        } else {
          const totalBlocks = parseInt(d[3]) + parseInt(d[4]);
          if (blocks && totalBlocks > 0) {
            const key = request.query.key || request.body.key;
            await index.axios
              .get(`http://localhost:8080/api/import/blocks/${d[1]}?key=${key}`)
              .then(async (res) => {
                if (res.data.success) {
                  blocksCounter += parseInt(
                    res.data.message.replace(" Blocks imported", "")
                  );
                  console.log(`Blocks of ${d[1]} imported`);
                } else {
                  // No blocks found in sheet --> Create new blocks
                  await index.axios
                    .post(`http://localhost:8080/api/blocks/createmultiple`, {
                      key: key,
                      district: d[1],
                      number: totalBlocks,
                      done: d[2] === "Done",
                    })
                    .then((res) => {
                      if (res.data.success) {
                        blocksCounter += parseInt(
                          res.data.message.replace(" Blocks imported", "")
                        );
                        console.log(`Blocks of ${d[1]} imported`);
                      } else {
                        console.log(`No data found for ${d[1]}`);
                      }
                    })
                    .catch((error) => {
                      console.log(`Error occurred for district ${d[1]}`, error);
                    });
                }
              })
              .catch((error) => {
                console.log(`Error occurred for district ${d[1]}`, error);
              });
          }
        }
      }
      districtCounter++;
    }

    return index.generateSuccess(
      `${districtCounter} Districts and ${blocksCounter} Blocks imported`
    );
  }
}
