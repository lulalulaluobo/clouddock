// Run the actual NAS v0.8.3 application; extend its authenticated router and
// post-migration lifecycle without replacing existing pages or business models.
const path = require("node:path");
const { createRequire } = require("node:module");
const runtime = process.env.CLOUDDOCK_UPSTREAM || "/app/dist-final";
const appRequire = createRequire(path.join(runtime, "app.js"));
const express = appRequire("express"), axios = appRequire("axios");
const { DataTypes, Op } = appRequire("sequelize");
const sequelize = appRequire("./config/database").default;
const User = appRequire("./models/User").default;
const { QuarkService } = appRequire("./services/QuarkService");
const { DatabaseService } = appRequire("./services/DatabaseService");
const { Quark } = require("./core.cjs");
const { createService } = require("./service.cjs");
const { createRouter } = require("./router.cjs");
const { BaiduNative } = require("./baidu-native.cjs");
const service = createService({ sequelize, DataTypes, Op, axios, clientForUser: async userId => { const driver = new QuarkService(); await driver.setCookie({ user: { userId } }); return new Quark(driver); } });
const initialize = DatabaseService.prototype.initialize;
const baidu = new BaiduNative({ sqlite3: appRequire("sqlite3"), axios, sequelize, DataTypes, Op, paths: service.paths });
DatabaseService.prototype.initialize = async function (...args) { await initialize.apply(this, args); await service.initialize(); await baidu.initialize(); };
const router = appRequire("./routes/api").default;
router.use("/clouddock", createRouter(express, service, User, baidu));
appRequire("./app.js");
