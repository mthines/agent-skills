import { Router } from "express";
import { search } from "../services/search";

export const searchRouter = Router();

searchRouter.get("/search", async (req, res) => {
  res.json(await search(String(req.query.q ?? "")));
});
