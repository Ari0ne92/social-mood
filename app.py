# -*- coding: utf-8 -*-
"""
灵感配方 Social Mood — 本地后端

说明：
    已接入 Agnes 3.0 Flash（OpenAI 兼容的 Chat Completions 接口）。
    - .env 里配置了 AGNES_API_KEY 时：调用真实模型生成文案与 BGM；
    - 未配置密钥、或接口调用失败时：自动退回本地预置的演示数据，
      并在响应里用 mock=True 标记，前端会明确显示「演示数据」。

启动（在项目目录下执行）：
    pip install -r requirements.txt
    python app.py
然后浏览器访问： http://127.0.0.1:5000
"""

import json
import os
import random
import re

import requests
from flask import Flask, jsonify, request, send_from_directory

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # 未安装 python-dotenv 时依然可以运行
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=None)

# ------------------------------------------------------------------
# Agnes AI 配置（密钥只写在 .env 里，不要写进代码）
# ------------------------------------------------------------------
AGNES_API_KEY = os.getenv("AGNES_API_KEY", "").strip()
AGNES_BASE_URL = os.getenv("AGNES_BASE_URL", "https://api.agnes-ai.cn/v1").strip().strip("`").rstrip("/")
AGNES_MODEL = os.getenv("AGNES_MODEL", "agnes-3.0-flash").strip()

SYSTEM_PROMPT = (
    "你是「灵感配方 Social Mood」的资深社媒内容策划，擅长为照片配出符合平台调性的文案与背景音乐。\n"
    "请严格只输出一个 JSON 对象，不要输出任何解释、前言或 Markdown 代码块，格式为：\n"
    '{"copies":[{"text":"文案正文","tags":"#话题1 #话题2"}, ...],"bgm":[{"title":"歌名","artist":"歌手","reason":"推荐理由"}, ...]}\n'
    "要求：\n"
    "1. copies 必须正好 3 条，中文，每条不超过 80 字，符合所选平台与风格的语气；tags 为 2-4 个带 # 的话题标签。\n"
    "2. bgm 必须正好 3 首，只推荐真实存在的歌曲，禁止编造歌名或歌手；reason 用一句话说明为什么适合这条内容。\n"
    "3. 严格输出合法 JSON，字符串内不要出现换行符。"
)


def build_user_prompt(platform, style, has_photo=False):
    photo_note = "用户已上传一张生活照片，请让文案更贴近照片记录生活的场景。" if has_photo else "用户这次没有上传照片。"
    return f"发布平台：{platform}\n文案风格：{style}\n{photo_note}\n请按约定的 JSON 格式给出 3 条文案和 3 首 BGM 推荐。"


class AIError(Exception):
    """调用真实模型失败时抛出。"""


def call_agnes(platform, style, has_photo=False):
    """调用 Agnes 3.0 Flash，返回 {"copies": [...], "bgm": [...]}。"""
    if not AGNES_API_KEY:
        raise AIError("未配置 AGNES_API_KEY")

    payload = {
        "model": AGNES_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(platform, style, has_photo)},
        ],
        "temperature": 0.9,
        "max_tokens": 1200,
    }
    headers = {
        "Authorization": "Bearer %s" % AGNES_API_KEY,
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(
            AGNES_BASE_URL + "/chat/completions",
            headers=headers,
            json=payload,
            timeout=90,
        )
    except requests.RequestException as exc:
        raise AIError("网络请求失败：%s" % exc)

    if resp.status_code != 200:
        raise AIError("接口返回 %s：%s" % (resp.status_code, resp.text[:200]))

    try:
        # 显式按 UTF-8 解码，避免中文乱码
        payload_json = json.loads(resp.content.decode("utf-8", errors="replace"))
        content = payload_json["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        raise AIError("响应结构异常：%s" % exc)

    return parse_ai_reply(content)


def parse_ai_reply(content):
    """把模型返回的文本解析成结构化结果，尽量容错。"""
    text = (content or "").strip()

    # 去掉可能出现的 ```json ... ``` 包裹
    text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
    text = re.sub(r"\s*```$", "", text).strip()

    # 只取最外层的一对花括号
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise AIError("模型未返回 JSON")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise AIError("JSON 解析失败：%s" % exc)

    copies = normalize_copies(data.get("copies"))
    bgm = normalize_bgm(data.get("bgm"))
    if not copies or not bgm:
        raise AIError("模型返回的内容不完整")

    return {"copies": copies, "bgm": bgm}


def normalize_copies(raw):
    """校验并整理文案字段。"""
    if not isinstance(raw, list):
        return []
    result = []
    for item in raw:
        if isinstance(item, str):
            text, tags = item, ""
        elif isinstance(item, dict):
            text = str(item.get("text", "")).strip()
            tags = str(item.get("tags", "")).strip()
        else:
            continue
        if text:
            result.append({"text": text, "tags": tags})
    return result[:3]


def normalize_bgm(raw):
    """校验并整理 BGM 字段。"""
    if not isinstance(raw, list):
        return []
    result = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        artist = str(item.get("artist", "")).strip()
        reason = str(item.get("reason", "")).strip()
        if title:
            result.append({"title": title, "artist": artist, "reason": reason})
    return result[:3]


# ------------------------------------------------------------------
# 兜底演示数据区（未配置密钥或接口调用失败时使用）
# ------------------------------------------------------------------

# 各风格的基础文案池
COPY_POOL = {
    "高级感": [
        "生活很吵，但今天的风刚刚好。",
        "光落下来的那一刻，世界变得很安静。",
        "不需要被理解，被记住就足够了。",
        "把日子过成自己喜欢的样子，就是最好的答案。",
        "有些瞬间不必解释，它本来就很美。",
    ],
    "松弛感": [
        "没什么大事发生，这就很好。",
        "不着急，慢慢来，日子会自己长出来。",
        "今天只想做个没什么用处但很开心的人。",
        "允许自己发呆，也允许自己什么都不做。",
        "风一吹，烦恼就散了。",
    ],
    "幽默": [
        "本以为是精致生活，结果是普通的一天。",
        "拍照五分钟，修图两小时，发出去三秒钟。",
        "别人在搞事业，我在搞吃的，我们都有光明的未来。",
        "这个角度我拍了 20 张，不发出来对不起手机。",
        "努力是会上瘾的，尤其是在你拍照的时候。",
    ],
    "简约": [
        "今天。",
        "晴，宜出门。",
        "安静的一天。",
        "日常，记录一下。",
        "随手一拍。",
    ],
    "朋友圈日常": [
        "把普通的一天，过成值得纪念的一天。",
        "最近的小日子，慢但是踏实。",
        "又是被生活温柔对待的一天。",
        "记录一下，免得以后忘了今天的心情。",
        "没什么特别，就是想分享给你看。",
    ],
}

# 不同平台的补充尾句 / 话题标签
PLATFORM_STYLE = {
    "朋友圈": {
        "suffix": "",
        "tags": "#日常记录 #生活碎片",
    },
    "小红书": {
        "suffix": "姐妹们冲！",
        "tags": "#氛围感 #生活碎片 #拍照打卡 #新手友好",
    },
    "抖音": {
        "suffix": "别划走，看到最后。",
        "tags": "#记录美好生活 #治愈系 #氛围感",
    },
}

# BGM 演示数据池
BGM_POOL = [
    {"title": "夏日漱石", "artist": "RADWIMPS", "reason": "前奏一响就有电影感，适合城市街拍与傍晚光线。"},
    {"title": "关于郑州的记忆", "artist": "李志", "reason": "叙事感强，适合长句文案，情绪克制又耐听。"},
    {"title": "Sweet Night", "artist": "V", "reason": "温柔的钢琴铺底，不抢画面，适合安静的生活片段。"},
    {"title": "春を知らせるもの", "artist": "羽毛田丈史", "reason": "干净通透，适合浅色调照片，整体氛围轻盈。"},
    {"title": "Sunset Lover", "artist": "Petit Biscuit", "reason": "节拍轻快，适合动态视频与节奏偏快的剪辑。"},
    {"title": "晚安", "artist": "鹿先森乐队", "reason": "尾音收得干净，适合作为图文结尾的情绪落点。"},
    {"title": "River Flows in You", "artist": "Yiruma", "reason": "旋律耳熟且有记忆点，适合干净极简的画面。"},
    {"title": "起风了", "artist": "买辣椒也用券", "reason": "情绪递进明显，适合配逆光、天台的画面。"},
]


def generate_copies(platform: str, style: str, count: int = 3):
    """生成演示文案：风格池中抽 3 条，再按平台补充尾句与话题标签。"""
    pool = COPY_POOL.get(style) or COPY_POOL["朋友圈日常"]
    chosen = random.sample(pool, k=min(count, len(pool)))

    platform_conf = PLATFORM_STYLE.get(platform) or PLATFORM_STYLE["朋友圈"]
    suffix = platform_conf["suffix"]
    tags = platform_conf["tags"]

    results = []
    for text in chosen:
        if platform == "小红书" and style == "简约":
            body = f"{text} | 极简版记录"
        elif suffix and random.random() < 0.5:
            body = f"{text} {suffix}"
        else:
            body = text
        results.append({"text": body, "tags": tags})
    return results


def recommend_bgm(count: int = 3):
    """推荐演示 BGM：随机抽 count 首。"""
    return random.sample(BGM_POOL, k=min(count, len(BGM_POOL)))


# ------------------------------------------------------------------
# 路由
# ------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    # 不允许通过浏览器直接访问 .env 等以点开头的敏感文件
    if filename.startswith(".") or os.path.basename(filename).startswith("."):
        return jsonify({"error": "not found"}), 404
    return send_from_directory(BASE_DIR, filename)


@app.route("/api/generate", methods=["POST"])
def api_generate():
    data = request.get_json(silent=True) or {}
    platform = data.get("platform") or "朋友圈"
    style = data.get("style") or "高级感"
    has_photo = bool(data.get("hasPhoto"))

    if platform not in PLATFORM_STYLE:
        platform = "朋友圈"
    if style not in COPY_POOL:
        style = "高级感"

    # 1) 优先调用真实模型
    if AGNES_API_KEY:
        try:
            ai_result = call_agnes(platform, style, has_photo)
            return jsonify(
                {
                    "mock": False,
                    "notice": "由 %s 生成" % AGNES_MODEL,
                    "source": AGNES_MODEL,
                    "platform": platform,
                    "style": style,
                    "copies": ai_result["copies"],
                    "bgm": ai_result["bgm"],
                }
            )
        except AIError as exc:
            app.logger.warning("调用 Agnes 失败，改用演示数据：%s", exc)
            fallback_notice = "调用真实模型失败（%s），已退回演示数据" % exc
    else:
        fallback_notice = "未配置 AGNES_API_KEY，当前为演示数据"

    # 2) 兜底：本地演示数据
    return jsonify(
        {
            "mock": True,
            "notice": fallback_notice,
            "source": "local-mock",
            "platform": platform,
            "style": style,
            "copies": generate_copies(platform, style, count=3),
            "bgm": recommend_bgm(count=3),
        }
    )


@app.route("/api/health")
def api_health():
    return jsonify(
        {
            "status": "ok",
            "mock": not bool(AGNES_API_KEY),
            "model": AGNES_MODEL if AGNES_API_KEY else None,
        }
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    print("灵感配方 Social Mood 已启动：http://127.0.0.1:%d" % port)
    if AGNES_API_KEY:
        print("模式：真实模型（%s @ %s）" % (AGNES_MODEL, AGNES_BASE_URL))
    else:
        print("模式：演示数据（未检测到 AGNES_API_KEY，请检查 .env）")
    app.run(host="0.0.0.0", port=port, debug=False)
