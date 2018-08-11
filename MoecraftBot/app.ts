import fs = require("fs");
import os = require("os");
import http = require('http');
import url = require('url');
import util = require('util');
import Telegraf from "telegraf"
import process = require("process");
import path = require("path");

console.log("MoeCraft Bot (Node) v1.0 Written by Kenvix");

const dir = path.normalize(__dirname + "/");
const cfg = require('config.json')(dir + 'config.json');

if (typeof (cfg) == "undefined") 
    throw new Error("failed to load config.json");

if (typeof (cfg.tg) == "undefined" || cfg.tg.key.length < 1)
    throw new Error("Telegram key undefined or config unreadable");

enum UserStatus {
    Idle,
    WaitingUsername,
    WaitingPassword
}

interface IAuthSession {
    [index: number]: { //Telegram UID
        "name": string //Telegram Name
        "status": UserStatus
    };
}

const bot = new Telegraf(cfg.tg.key);
let AuthSession: IAuthSession = {};

bot.command('start', (ctx) => {
    ctx.reply("欢迎使用 MoeCraft Telegram 认证管理工具\n请输入您的 MoeCraft 用户中心的用户名或邮箱")
    AuthSession[ctx.chat.id] = {
        "name": ctx.chat.username,
        "status": UserStatus.WaitingUsername
    }
});

bot.command('session', (ctx) => {
    ctx.reply("Session ID: " + ctx.chat.id + "\n" + "User Name: " + ctx.chat.username);
    if (typeof (ctx.chat.id) == "undefined" || typeof (AuthSession[ctx.chat.id]) == "undefined" || AuthSession[ctx.chat.id].status == UserStatus.Idle)
        ctx.reply("Session not started or marked as idle");
    else
        ctx.reply("Session status: " + AuthSession[ctx.chat.id].status.toString());
});

bot.command('cancel', (ctx) => {
    AuthSession[ctx.chat.id] = undefined;
    ctx.reply("会话已结束，若要重新开始认证，请输入 /start")
});

bot.hears("(.*)", (ctx) => {
    if (typeof (ctx.chat.id) == "undefined" || typeof (AuthSession[ctx.chat.id]) == "undefined" || AuthSession[ctx.chat.id].status == UserStatus.Idle)
        return;

});

console.log("Start polling telegram message");
bot.startPolling();