import fs = require("fs");
import os = require("os");
import util = require('util');
import Telegraf from "telegraf"
import process = require("process");
import path = require("path");
import superagent = require("superagent");

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
    WaitingPassword,
    Done
}

interface IAuthData {
    "email": string
    "password": string
}

interface IAuthSession {
    [index: number]: { //Telegram UID
        "name": string //Telegram Name
        "status": UserStatus,
        "data": IAuthData
    };
}

const bot = new Telegraf(cfg.tg.key);
let AuthSession: IAuthSession = {};

bot.command('start', (ctx) => {
    ctx.reply("欢迎使用 MoeCraft Telegram 认证管理工具\n请输入您的 MoeCraft 用户中心的用户名或邮箱")
    AuthSession[ctx.chat.id] = {
        "name": ctx.chat.username,
        "status": UserStatus.WaitingUsername, 
        "data": {
            "email": "",
            "password": ""
        }
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
    ctx.reply("会话已结束，若要重新开始认证，请输入 /start");
});

bot.command('back', (ctx) => {
    if (typeof (ctx.chat.id) == "undefined" || typeof (AuthSession[ctx.chat.id]) == "undefined" || AuthSession[ctx.chat.id].status == UserStatus.Idle) {
        ctx.reply("会话尚未开始，不能回退");
        return;
    }
    switch (AuthSession[ctx.chat.id].status) {
        case UserStatus.WaitingPassword:
            AuthSession[ctx.chat.id].status = UserStatus.WaitingUsername;
            ctx.reply("已回退到上一步：请输入您的 MoeCraft 用户中心的用户名或邮箱");
            break;
        case UserStatus.WaitingUsername:
            AuthSession[ctx.chat.id] = undefined;
            ctx.reply("已回退到顶层：会话已结束，若要重新开始认证，请输入 /start");
            break;
    }
});

bot.on('message', (ctx) => {
    if (typeof (ctx.chat.id) == "undefined" || typeof (AuthSession[ctx.chat.id]) == "undefined" || AuthSession[ctx.chat.id].status == UserStatus.Idle)
        return;
    let session = AuthSession[ctx.chat.id];
    let msg = ctx.message.text;
    switch (AuthSession[ctx.chat.id].status) {
        case UserStatus.WaitingUsername:
            session.data.email = msg;
            session.status = UserStatus.WaitingPassword;
            ctx.reply("接下来，请输入您的密码：\n若输入错误，请输入 /back 回退到上一步");
            break;
        case UserStatus.WaitingPassword:
            session.data.password = msg;
            ctx.reply("请稍等，正在进行认证");
            try {
                superagent
                    .post(cfg.api.url)
                    .send({
                        login: session.data.email,
                        password: session.data.password
                    })
                    .set('Useragent', 'MoeCraft Bot')
                    .end((err, res) => {
                        if (err) throw err;
                        console.log(res);
                    });
            } catch (ex) {
                ctx.reply("认证出错：" + ex.name + ":" + ex.message);
                console.log("<!> Failed to authorize user: " + session.name);
                console.log(ex);
            }
            break;
    }
});


console.log("Start polling telegram message");
bot.startPolling();