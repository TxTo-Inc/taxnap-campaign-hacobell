"""ハコベル×タックスナップ インボイスキャンペーン用の Google 資産を作成する。

- フォルダ「ハコベル_インボイスキャンペーン」
- 回答スプレッドシート（GAS の置き場。シートは GAS の setup() が作る）
- インボイス申請アンケート（Google フォーム）

実行: ~/.config/gcloud-oauth/venv/bin/python tools/create_google_assets.py
結果の ID は tools/google_assets.json に保存する（再実行時は作り直さない）。
"""
import json, os, sys, time
sys.path.insert(0, os.path.expanduser("~/.config/gcloud-oauth"))
from auth import get_creds
from googleapiclient.discovery import build

OUT = os.path.join(os.path.dirname(__file__), "google_assets.json")
state = json.load(open(OUT)) if os.path.exists(OUT) else {}

creds = get_creds()
drive = build("drive", "v3", credentials=creds)
sheets = build("sheets", "v4", credentials=creds)
forms = build("forms", "v1", credentials=creds)

def save():
    json.dump(state, open(OUT, "w"), ensure_ascii=False, indent=2)

# ---- フォルダ ----
if "folder_id" not in state:
    f = drive.files().create(body={"name": "ハコベル_インボイスキャンペーン",
                                   "mimeType": "application/vnd.google-apps.folder"},
                             fields="id").execute()
    state["folder_id"] = f["id"]; save()

def move(file_id):
    cur = drive.files().get(fileId=file_id, fields="parents").execute().get("parents", [])
    drive.files().update(fileId=file_id, addParents=state["folder_id"],
                         removeParents=",".join(cur), fields="id").execute()

# ---- スプレッドシート ----
if "sheet_id" not in state:
    s = sheets.spreadsheets().create(body={
        "properties": {"title": "ハコベル_インボイスキャンペーン_回答"},
        "sheets": [{"properties": {"title": "はじめに"}}]}).execute()
    state["sheet_id"] = s["spreadsheetId"]; save()
    move(state["sheet_id"])
    sheets.spreadsheets().values().update(
        spreadsheetId=state["sheet_id"], range="はじめに!A1", valueInputOption="RAW",
        body={"values": [
            ["このスプレッドシートは、ハコベル×タックスナップ インボイスキャンペーンの回答保存先です。"],
            ["拡張機能 > Apps Script に gas/Code.gs を貼り、setup() を1回実行するとシートが作られます。"],
            ["個人情報を含むため、共有範囲はキャンペーン担当者に限定してください。"]]}).execute()

# ---- Google フォーム ----
if "form_id" not in state:
    f = forms.forms().create(body={"info": {
        "title": "インボイス申請アンケート｜ハコベル×タックスナップ",
        "documentTitle": "ハコベル_インボイス申請アンケート"}}).execute()
    state["form_id"] = f["formId"]; save()
    move(state["form_id"])

    desc = (
        "ハコベル×タックスナップ「インボイス登録で確定申告アプリが最大無料」キャンペーンの申請フォームです。\n"
        "送信いただくと、タックスナップの1万円割引クーポンをメールでお送りします。\n\n"
        "【入力内容の使いみち】\n"
        "・インボイス登録番号：ハコベルの支払明細への記載／国税庁の公表サイトで有効な番号かの確認\n"
        "・氏名：国税庁に登録された名義との照合\n"
        "・ドライバーID：ハコベルのご利用状況（支払条件）の確認\n"
        "・タックスナップの登録メールアドレス：タックスナップのご利用状況の確認（ハコベルには提供しません）\n\n"
        "運営：株式会社タックスナップ\n"
        "プライバシーポリシー：https://taxnap.com/privacy_policy"
    )
    reqs = [
        {"updateFormInfo": {"info": {"description": desc}, "updateMask": "description"}},
        # Q1 登録状況（分岐は後で設定）
        {"createItem": {"location": {"index": 0}, "item": {
            "title": "インボイス登録の状況を教えてください",
            "questionItem": {"question": {"required": True, "choiceQuestion": {
                "type": "RADIO", "options": [
                    {"value": "Ａ：インボイス登録済みで、ハコベルにも番号を登録済み"},
                    {"value": "Ｂ：インボイス登録済みだが、ハコベルにはまだ番号を伝えていない"},
                    {"value": "Ｃ：このキャンペーンをきっかけに、新しくインボイス登録した"}]}}}}}},
        # セクション2：番号（Ｂ・Ｃ）
        {"createItem": {"location": {"index": 1}, "item": {
            "title": "インボイス登録番号", "description": "Ｂ・Ｃの方はご入力ください",
            "pageBreakItem": {}}}},
        {"createItem": {"location": {"index": 2}, "item": {
            "title": "インボイス登録番号（T＋13桁）",
            "description": "例：T1234567890123　税務署から届いた登録通知に記載されています",
            "questionItem": {"question": {"required": True, "textQuestion": {"paragraph": False}}}}}},
        # セクション3：共通
        {"createItem": {"location": {"index": 3}, "item": {
            "title": "ご本人情報", "pageBreakItem": {}}}},
        {"createItem": {"location": {"index": 4}, "item": {
            "title": "氏名（フルネーム）",
            "description": "インボイス登録と同じ名義でご入力ください（旧姓・通称で登録した方はその名義）",
            "questionItem": {"question": {"required": True, "textQuestion": {"paragraph": False}}}}}},
        {"createItem": {"location": {"index": 5}, "item": {
            "title": "ハコベルのドライバーID",
            "description": "ハコベルのアプリの ？？？ で確認できます",
            "questionItem": {"question": {"required": True, "textQuestion": {"paragraph": False}}}}}},
        {"createItem": {"location": {"index": 6}, "item": {
            "title": "タックスナップに登録しているメールアドレス",
            "description": "まだタックスナップに登録していない方は、これから登録に使うメールアドレスをご入力ください。クーポンもこのアドレスにお送りします",
            "questionItem": {"question": {"required": True, "textQuestion": {"paragraph": False}}}}}},
        {"createItem": {"location": {"index": 7}, "item": {
            "title": "個人情報の提供への同意",
            "description": ("入力したインボイス登録番号・氏名・ドライバーID、およびタックスナップの契約状況（契約プラン・支払額）を、"
                            "キャンペーンの対象確認・支払い、および支払明細への登録番号の記載のために、"
                            "株式会社タックスナップからハコベル株式会社へ提供します。"
                            "同意はいつでも撤回でき、撤回後は提供を停止します。"),
            "questionItem": {"question": {"required": True, "choiceQuestion": {
                "type": "CHECKBOX", "options": [
                    {"value": "上記の内容とプライバシーポリシーに同意します"}]}}}}}},
    ]
    forms.forms().batchUpdate(formId=state["form_id"], body={"requests": reqs}).execute()

if not state.get("branched"):
    # 分岐：Ａはセクション2（番号）を飛ばして共通セクションへ
    form = forms.forms().get(formId=state["form_id"]).execute()
    items = form["items"]
    q_status = items[0]
    sec_common = [i for i in items if i.get("title") == "ご本人情報"][0]
    opts = q_status["questionItem"]["question"]["choiceQuestion"]["options"]
    new_opts = []
    for o in opts:
        o2 = {"value": o["value"]}
        if o["value"].startswith("Ａ"):
            o2["goToSectionId"] = sec_common["itemId"]
        else:
            o2["goToAction"] = "NEXT_SECTION"   # 全選択肢に行き先の指定が必要
        new_opts.append(o2)
    forms.forms().batchUpdate(formId=state["form_id"], body={"requests": [{
        "updateItem": {"location": {"index": 0}, "updateMask": "questionItem.question.choiceQuestion.options",
                       "item": {"itemId": q_status["itemId"], "questionItem": {"question": {
                           "questionId": q_status["questionItem"]["question"]["questionId"],
                           "choiceQuestion": {"type": "RADIO", "options": new_opts}}}}}}]}).execute()
    state["branched"] = True; save()

form = forms.forms().get(formId=state["form_id"]).execute()
state["form_responder_url"] = form["responderUri"]
state["form_edit_url"] = f"https://docs.google.com/forms/d/{state['form_id']}/edit"
state["sheet_url"] = f"https://docs.google.com/spreadsheets/d/{state['sheet_id']}/edit"
state["questions"] = {i["title"]: i["questionItem"]["question"]["questionId"]
                      for i in form["items"] if "questionItem" in i}
save()
print(json.dumps(state, ensure_ascii=False, indent=2))
