import fse from "fs-extra";
import Telegraf, { ContextMessageUpdate, Telegram } from "telegraf";
import process from "process";
import path from "path";
import superagent from "superagent";
import querystring from "querystring";
import commander from "commander";
import { IncomingMessage } from "telegraf/typings/telegram-types";

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
    email: string;
    password: string;
    uid?: number;
    name?: string;
}

interface IAuthSession {
    name: string; // Telegram Name
    status: UserStatus;
    data: IAuthData;
}

interface IAuthSessions {
    [index: number]: IAuthSession;
}

interface IGroup { // Telegram Chat ID
    enabled: boolean;
    operator: number; // Operator Telegram ID
}

interface IGroups {
    [index: number]: IGroup;
}

commander.version('1.0.0')
    .option('-x, --debug', 'Enable debug functions')
    .option('-b, --bots', 'Also check bots')
    .parse(process.argv);

console.log("MoeCraft Bot (Node) v1.0 Written by Kenvix");

async function main() {
    const dir = path.normalize(__dirname + "/");
    const cfg = require('config.json')(dir + 'config.json');

    if (typeof (cfg) == "undefined")
        throw new Error("failed to load config.json");

    if (typeof (cfg.tg) == "undefined" || cfg.tg.key.length < 1)
        throw new Error("Telegram key undefined or config unreadable");

    function isDebugMode(): boolean {
        return commander.debug;
    }

    async function isAdmin(ctx: ContextMessageUpdate, id: number): Promise<boolean> {
        let admins = await ctx.getChatAdministrators();

        for (const admin of admins) {
            if (admin.user.id == id)
                return true;
        }

        return false;
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
        username: cfg.tg.name,
        telegram: {           // Telegram options
            agent: Agent        // https.Agent instance, allows custom proxy, certificate, keep alive, etc.
        }
    });
    const telegram = new Telegram(cfg.tg.key, {
        agent: Agent
    });

    let AuthSession: IAuthSessions = {};
    let Groups: IGroups = {};

    async function SaveGroups() {
        await fse.writeFile(dir + 'groups.json', JSON.stringify(Groups));
    }

    bot.command('start', async (ctx) => {
        if (ctx.chat!.type !== ChatType.Private)
            return;

        ctx.reply("欢迎使用 MoeCraft Telegram 认证管理工具\n请输入您的 MoeCraft 用户中心的用户名或邮箱");

        AuthSession[ctx.message!.from!.id!] = {
            name: ctx.message!.from!.username!,
            status: UserStatus.WaitingUsername,
            data: {
                email: "",
                password: ""
            }
        }
    });

    bot.command('session', async (ctx) => {
        const user = ctx.message && ctx.message.from;
        const userId = user && user.id;
        const userName = user && user.username;

        const chat = ctx.chat;

        ctx.reply(`User ID: ${userId}\nChat ID: ${chat && chat.id!}\nUsername: ${userName}`);

        if (chat && chat.type == ChatType.Private) {
            if (!userId || AuthSession[userId] || AuthSession[userId].status == UserStatus.Idle)
                ctx.reply("Session not started or marked as idle");
            else
                ctx.reply("Session status: " + AuthSession[userId].status.toString());
        }
    });

    bot.command('dump', async (ctx) => {
        if (!isDebugMode())
            return;

        ctx.reply("AuthSession:\n" + JSON.stringify(AuthSession));
        ctx.reply("Groups:\n" + JSON.stringify(Groups));
    });

    bot.command('cancel', async (ctx) => {
        if (ctx.chat && ctx.chat.type == ChatType.Private) {
            delete AuthSession[ctx.message!.from!.id!];
            ctx.reply("会话已结束，若要重新开始认证，请输入 /start");
        }
    });

    bot.command('back', async (ctx) => {
        const user = ctx.message && ctx.message.from;
        const userId = user && user.id;
        const userName = user && user.username;

        if (ctx.chat && ctx.chat.type == ChatType.Private) {
            if (!userId || !AuthSession[userId] || AuthSession[userId].status == UserStatus.Idle) {
                ctx.reply("会话尚未开始，不能回退");
                return;
            }

            switch (AuthSession[userId].status) {
                case UserStatus.WaitingPassword:
                    AuthSession[userId].status = UserStatus.WaitingUsername;
                    ctx.reply("已回退到上一步：请输入您的 MoeCraft 用户中心的用户名或邮箱");
                    break;
                case UserStatus.WaitingUsername:
                    delete AuthSession[userId];
                    ctx.reply("已回退到顶层：会话已结束，若要重新开始认证，请输入 /start");
                    break;
            }
        }
    });

    bot.command('help', async (ctx) => {
        ctx.reply(`通用 MoeCraft 认证管理工具 (MoeCraft Bot)
作者：Kenvix [ https://kenvix.com ]
========================
/status  查看 MoeCraft 认证管理 状态
/enable  在本群组启用 MoeCraft 认证管理
/disable 在本群组停用 MoeCraft 认证管理
/help    查看帮助
/start   开始认证会话(仅限私聊)
/back    回退认证会话(仅限私聊)
/cancel  终止认证会话(仅限私聊)
/session 输出会话信息`);
    });
    
    bot.command('enable', async (ctx) => {
        try {
            if (!ctx.chat || !ctx.from)
                throw new Error("未知错误");

            if (ctx.chat.all_members_are_administrators || await isAdmin(ctx, ctx.from.id)) {
                Groups[ctx.chat.id] = {
                    "enabled": true,
                    "operator": ctx.from.id
                };
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
            if (!ctx.chat || !ctx.from)
                throw new Error("未知错误");

            if (ctx.chat.all_members_are_administrators || isAdmin(ctx, ctx.from.id)) {
                Groups[ctx.chat.id] = {
                    enabled: false,
                    operator: ctx.from.id
                };
                SaveGroups();

                ctx.reply("已对群组 " + ctx.chat.id + " 禁用 MoeCraftBot");
            } else {
                throw new Error("操作者必须是管理员");
            }
        } catch (ex) {
            ctx.reply("禁用失败：" + ex.name + ":" + ex.message);
        }
    });

    bot.command('status', async (ctx) => {
        const chatId = ctx.chat && ctx.chat.id;
        if (chatId && Groups[chatId].enabled)
            ctx.reply("+ 已对群组 " + chatId + " 启用 MoeCraftBot");
        else
            ctx.reply("- 未对群组 " + chatId + " 启用 MoeCraftBot");
    });

    bot.on('edited_message', async (ctx) => {
        if (!ctx.chat || ctx.chat.type !== ChatType.Private)
            return;

        const user = ctx.editedMessage && ctx.editedMessage.from;
        const userId = user && user.id;

        if (!userId || !AuthSession[userId] || AuthSession[userId].status == UserStatus.Idle)
            return;

        switch (AuthSession[userId].status) {
            case UserStatus.WaitingPassword:
                AuthSession[userId].data.email = ctx.editedMessage!.text!;
                ctx.reply("编辑用户名成功，接下来，请输入您的密码：");
                break;
            case UserStatus.Done:
                ctx.reply("您已完成认证，直接点击之前给出的链接即可加入群组。若要重新认证，请输入 /start");
                break;
        }
    });

    bot.on('new_chat_members', async (ctx) => {
        const chatId = ctx.chat!.id;
        if (Groups[chatId] && !Groups[chatId].enabled)
            return;

        ctx.message!.new_chat_members!.forEach((member, key) => {
            if (!commander.bots && member.is_bot)
                return;

            if (!AuthSession[member.id] || AuthSession[member.id].status != UserStatus.Done) {
                // Typing for telegraf has a bug
                (telegram as any).kickChatMember(chatId, member.id)
                    .catch((error: Error) => {
                        ctx.reply("踢出未认证用户失败：" + error.message);
                    });
            } else {
                ctx.reply(`欢迎 ${AuthSession[member.id].data.name} [ ${member.first_name} ] 加入 MoeCraft Group!`);
            }
        });
    });

    bot.on('message', async (ctx) => {
        if (!ctx.chat || ctx.chat.type !== ChatType.Private)
            return;

        const user = ctx.message && ctx.message.from;
        const userId = user && user.id;

        if (!userId || !AuthSession[userId] || AuthSession[userId].status == UserStatus.Idle)
            return;

        let session = AuthSession[userId];
        let msg = ctx.message && ctx.message.text;

        switch (AuthSession[userId].status) {
            case UserStatus.WaitingUsername:
                session.data.email = msg + "";
                session.status = UserStatus.WaitingPassword;

                ctx.reply("接下来，请输入您的密码：\n若刚才的用户名输入错误，直接您发送的编辑那条消息即可");
                break;
            case UserStatus.WaitingPassword:
                DoAuth(ctx, ctx.message!, session);
                break;
        }
    });

    function DoAuth(ctx: ContextMessageUpdate, ctxmsg: IncomingMessage, session: IAuthSession) {
        session.data.password = ctxmsg.text + "";
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

                    if (!res || res.text.length < 1)
                        throw new Error("接收认证服务器返回数据失败");

                    let data = JSON.parse(res.text);
                    if (!data)
                        throw new Error("解析认证服务器返回数据失败");

                    if (data.status != 0) {
                        ctx.reply("错误：" + data.info);
                        return;
                    }

                    if (typeof (data.uid) != "undefined" && data.uid > 0) {
                        session.status = UserStatus.Done;
                        session.data.uid = data.uid;
                        session.data.name = data.name;
                        for (let key in Groups) {
                            (telegram as any).unbanChatMember(key, ctxmsg.from!.id)
                                .catch(() => { });
                        }
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

    const exists = fse.existsSync(dir + 'groups.json');
    if (exists) {
        try {
            const data = await fse.readFile(dir + 'groups.json', 'utf8');
            Groups = JSON.parse(data);
        } catch (err) {
            console.warn("<!> Failed to load groups: groups.json");
            console.warn(err);
        }
    }

    if (Agent == null)
        console.log("Start polling telegram message (no proxy)");
    else
        console.log("Start polling telegram message. Proxy type: " + cfg.tg.proxy.type);

    bot.startPolling();
}

main();
