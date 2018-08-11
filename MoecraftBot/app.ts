import fs = require("fs");
import os = require("os");
import util = require('util');
import Telegraf, { ContextMessageUpdate } from "telegraf";
import process = require("process");
import path = require("path");
import superagent = require("superagent");
import querystring = require('querystring');
import commander = require("commander");
import { IncomingMessage, ChatMember } from "telegraf/typings/telegram-types";
import Telegram = require('telegraf/telegram');
import { fail } from "assert";
import { exists } from "fs";

commander.version('1.0.0')
    .option('-x, --debug', 'Enable debug functions')
    .option('-b, --bots', 'Also check bots')
    .parse(process.argv);

console.log("MoeCraft Bot (Node) v1.0 Written by Kenvix");

(async () => {
    const dir = path.normalize(__dirname + "/");
    const cfg = require('config.json')(dir + 'config.json');

    if (typeof (cfg) == "undefined")
        throw new Error("failed to load config.json");

    if (typeof (cfg.tg) == "undefined" || cfg.tg.key.length < 1)
        throw new Error("Telegram key undefined or config unreadable");

    function isDebugMode(): boolean {
        return commander.debug;
    }

    async function isAdmin(members: Promise<ChatMember[]>, id: number): Promise<boolean> {
        let MembersArray = await members;
        for (var i = 0; i < MembersArray.length; i++) {
            if (MembersArray[i].user.id == id) return true;
        }
        return false;
    }

    enum UserStatus {
        Idle,
        WaitingUsername,
        WaitingPassword,
        Done
    }

    enum ChatType {
        Private = "private",
        Group = "group",
        SuperGroup = "supergroup",
        Channel = "channel"
    }

    interface IAuthData {
        "email": string
        "password": string
        "uid"?: number
        "name"?: string
    }

    interface IAuthSession {
        [index: number]: { //Telegram UID
            "name": string //Telegram Name
            "status": UserStatus,
            "data": IAuthData
        };
    }


    interface IGroups {
        [index: number]: { //Telegram Chat ID
            "enabled": boolean
            "operator": number //Operator Telegram ID
        };
    }

    let Agent = null;

    switch (cfg.tg.proxy.type) {
        case "socks5":
            let SocksAgent = require('socks5-https-client/lib/Agent');
            Agent = new SocksAgent({
                socksHost: cfg.tg.proxy.socks5.host,
                socksPort: cfg.tg.proxy.socks5.port,
                socksUsername: cfg.tg.proxy.socks5.user,
                socksPassword: cfg.tg.proxy.socks5.password,
            });
            break;

        case "https":
            const HttpsProxyAgent = require('https-proxy-agent')
            Agent = new HttpsProxyAgent(cfg.tg.proxy.https.url);
            break;
    }

    const bot = new Telegraf(cfg.tg.key, {
        telegram: {           // Telegram options
            agent: Agent        // https.Agent instance, allows custom proxy, certificate, keep alive, etc.
        }
    });
    const telegram = new Telegram(cfg.tg.key, {
        agent: Agent
    });
    let AuthSession: IAuthSession = {};
    let Groups: IGroups = {}

    function SaveGroups() {
        fs.writeFile(dir + 'groups.json', JSON.stringify(Groups), (err) => {
            if (err) throw err;
        });
    }

    bot.command('start', async (ctx) => {
        if (ctx.chat.type == ChatType.Private) {
            ctx.reply("欢迎使用 MoeCraft Telegram 认证管理工具\n请输入您的 MoeCraft 用户中心的用户名或邮箱")
            AuthSession[ctx.message.from.id] = {
                "name": ctx.message.from.username,
                "status": UserStatus.WaitingUsername,
                "data": {
                    "email": "",
                    "password": ""
                }
            }
        }
    });

    bot.command('session', async (ctx) => {
        ctx.reply("User ID: " + ctx.message.from.id + "\nChat ID: " + ctx.chat.id + "\n" + "User Name: " + ctx.message.from.username);
        if (ctx.chat.type == ChatType.Private) {
            if (typeof (ctx.message.from.id) == "undefined" || typeof (AuthSession[ctx.message.from.id]) == "undefined" || AuthSession[ctx.message.from.id].status == UserStatus.Idle)
                ctx.reply("Session not started or marked as idle");
            else
                ctx.reply("Session status: " + AuthSession[ctx.message.from.id].status.toString());
        }
    });

    bot.command('dump', async (ctx) => {
        if (!isDebugMode()) return;
        ctx.reply("AuthSession:\n" + JSON.stringify(AuthSession));
        ctx.reply("Groups:\n" + JSON.stringify(Groups));
    });

    bot.command('cancel', async (ctx) => {
        if (ctx.chat.type == ChatType.Private) {
            AuthSession[ctx.message.from.id] = undefined;
            ctx.reply("会话已结束，若要重新开始认证，请输入 /start");
        }
    });

    bot.command('back', async (ctx) => {
        if (ctx.chat.type == ChatType.Private) {
            if (typeof (ctx.message.from.id) == "undefined" || typeof (AuthSession[ctx.message.from.id]) == "undefined" || AuthSession[ctx.message.from.id].status == UserStatus.Idle) {
                ctx.reply("会话尚未开始，不能回退");
                return;
            }
            switch (AuthSession[ctx.message.from.id].status) {
                case UserStatus.WaitingPassword:
                    AuthSession[ctx.message.from.id].status = UserStatus.WaitingUsername;
                    ctx.reply("已回退到上一步：请输入您的 MoeCraft 用户中心的用户名或邮箱");
                    break;
                case UserStatus.WaitingUsername:
                    AuthSession[ctx.message.from.id] = undefined;
                    ctx.reply("已回退到顶层：会话已结束，若要重新开始认证，请输入 /start");
                    break;
            }
        }
    });

    bot.command('enable', async (ctx) => {
        try {
            let ChatAdmins = ctx.getChatAdministrators();
            if (ctx.chat.all_members_are_administrators || await isAdmin(ChatAdmins, ctx.from.id)) {
                Groups[ctx.chat.id] = {
                    "enabled": true,
                    "operator": ctx.from.id
                }
                SaveGroups();
                ctx.reply("已对群组 " + ctx.chat.id + " 启用 MoeCraftBot");
            } else {
                throw new Error("操作者必须是管理员");
            }
        } catch (ex) {
            ctx.reply("启用失败：" + ex.name + ":" + ex.message);
        }
    });

    bot.command('disable', async (ctx) => {
        try {
            let ChatAdmins = ctx.getChatAdministrators();
            if (ctx.chat.all_members_are_administrators || isAdmin(ChatAdmins, ctx.from.id)) {
                Groups[ctx.chat.id] = {
                    "enabled": false,
                    "operator": ctx.from.id
                }
                SaveGroups();
                ctx.reply("已对群组 " + ctx.chat.id + " 禁用 MoeCraftBot");
            } else {
                throw new Error("操作者必须是管理员");
            }
        } catch (ex) {
            ctx.reply("禁用失败：" + ex.name + ":" + ex.message);
        }
    });

    bot.on('edited_message', async (ctx) => {
        if (ctx.chat.type == ChatType.Private) {
            let editMessage = ctx.editedMessage;
            if (typeof (editMessage.from.id) == "undefined" || typeof (AuthSession[editMessage.from.id]) == "undefined" || AuthSession[editMessage.from.id].status == UserStatus.Idle) return;
            switch (AuthSession[editMessage.from.id].status) {
                case UserStatus.WaitingPassword:
                    AuthSession[editMessage.from.id].data.email = editMessage.text;
                    ctx.reply("编辑用户名成功，接下来，请输入您的密码：");
                    break;
                case UserStatus.Done:
                    ctx.reply("您已完成认证，直接点击之前给出的链接即可加入群组。若要重新认证，请输入 /start");
                    break;
            }
        }
    });

    bot.on('new_chat_members', async (ctx) => {
        if (typeof (Groups[ctx.chat.id]) == "undefined" || Groups[ctx.chat.id].enabled) {
            ctx.message.new_chat_members.forEach((value, key) => {
                if (!commander.bots && value.is_bot) return;
                if (typeof (AuthSession[value.id]) == "undefined" || AuthSession[value.id].status != UserStatus.Done) {
                    try {
                        telegram.kickChatMember(ctx.chat.id, value.id);
                    } catch { }
                } else {
                    ctx.reply("欢迎 " + AuthSession[value.id].data.name + " [ " + value.first_name + " ] 加入 MoeCraft Group!");
                }
            });
        }
    });

    bot.on('message', async (ctx) => {
        if (ctx.chat.type == ChatType.Private) {
            if (typeof (ctx.message.from.id) == "undefined" || typeof (AuthSession[ctx.message.from.id]) == "undefined" || AuthSession[ctx.message.from.id].status == UserStatus.Idle)
                return;
            let session = AuthSession[ctx.message.from.id];
            let msg = ctx.message.text;
            switch (AuthSession[ctx.message.from.id].status) {
                case UserStatus.WaitingUsername:
                    session.data.email = msg;
                    session.status = UserStatus.WaitingPassword;
                    ctx.reply("接下来，请输入您的密码：\n若输入错误，直接您发送的编辑那条消息即可");
                    break;
                case UserStatus.WaitingPassword:
                    DoAuth(ctx, ctx.message, session);
                    break;
            }
        }
    });

    function DoAuth(ctx: ContextMessageUpdate, ctxmsg: IncomingMessage, session) {
        session.data.password = ctxmsg.text;
        ctx.reply("请稍等，正在进行认证");
        try {
            superagent
                .post(cfg.api.url)
                .send(querystring.stringify({
                    login: session.data.email,
                    password: session.data.password
                }))
                .set('Useragent', 'MoeCraft Bot')
                .end((err, res) => {
                    if (err) throw err;
                    if (typeof (res) == "undefined" || res.text.length < 1)
                        throw new Error("接收认证服务器返回数据失败");
                    let data = JSON.parse(res.text);
                    if (typeof (res) == "undefined" || !res)
                        throw new Error("解析认证服务器返回数据失败");
                    if (data.status != 0) {
                        ctx.reply("错误：" + data.info);
                        return;
                    }
                    if (typeof (data.uid) != "undefined" && data.uid > 0) {
                        session.status = UserStatus.Done;
                        session.data.uid = data.uid;
                        session.data.name = data.name;
                        ctx.reply("认证成功: 欢迎回来，" + data.name + "\n感谢您加入 MoeCraft，以下是 MoeCraft Group 邀请链接：\n" + cfg.api.group + "\n本次会话结束后链接失效。为了确保安全，请在入群后删除本次会话");
                        return;
                    }
                    throw new Error("未知错误");
                });
        } catch (ex) {
            ctx.reply("认证出错：" + ex.name + ":" + ex.message);
            console.warn("<!> Failed to authorize user: " + session.name);
            console.warn(ex);
        }
    }

    fs.exists(dir + 'groups.json', (exists) => {
        fs.readFile(dir + 'groups.json', 'utf8', (err, data) => {
            if (err) {
                console.warn("<!> Failed to load groups: groups.json");
                console.warn(err);
            }
            Groups = JSON.parse(data);
        });
    });

    if (Agent == null)
        console.log("Start polling telegram message (no proxy)");
    else
        console.log("Start polling telegram message. Proxy type: " + cfg.tg.proxy.type);

    bot.startPolling();
}) ();