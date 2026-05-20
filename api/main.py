import os
from datetime import date, datetime, time, timezone
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import Client, create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVER_DB_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if origin.strip()]

app = FastAPI(title="Reverie Companion API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client: Client | None = create_client(SUPABASE_URL, SERVER_DB_KEY) if SUPABASE_URL and SERVER_DB_KEY else None


class ProfileCreateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    preferred_language: str | None = Field(default=None, max_length=20)
    voice_reply_enabled: bool | None = None
    large_text_enabled: bool | None = None
    high_contrast_enabled: bool | None = None
    emergency_note: str | None = Field(default=None, max_length=1000)


class MemoryRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=4000)
    memory_type: Literal["general", "where_kept", "person", "routine", "medical"] = "general"


class ObjectLocationRequest(BaseModel):
    object_name: str = Field(min_length=1, max_length=120)
    location_text: str = Field(min_length=1, max_length=500)
    photo_url: str | None = None


class DailyBoardRequest(BaseModel):
    board_date: date
    label: str = Field(min_length=1, max_length=160)
    detail: str | None = Field(default=None, max_length=1000)
    scheduled_time: time | None = None
    item_type: Literal["medicine", "appointment", "routine", "family", "note"] = "note"


class ReminderRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    detail: str | None = Field(default=None, max_length=1000)
    category: Literal["medicine", "appointment", "hydration", "meal", "custom"] = "custom"
    scheduled_date: date
    scheduled_time: time
    repeat_rule: Literal["none", "daily", "weekly", "monthly"] = "none"
    escalation_minutes: int = Field(default=10, ge=1, le=240)
    caregiver_escalation_enabled: bool = True


class ReminderAcknowledgeRequest(BaseModel):
    status: Literal["done", "skipped", "needs_help"] = "done"


class PhotoCardRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    relationship: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=1000)
    image_url: str | None = None


class EmergencyContactRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    relationship: str | None = Field(default=None, max_length=120)
    phone: str = Field(min_length=3, max_length=40)
    sort_order: int = 0


class DeviceRegisterRequest(BaseModel):
    profile_id: str | None = None
    platform: str = Field(default="android", max_length=40)
    token: str = Field(min_length=8, max_length=512)
    enabled: bool = True


class InviteAcceptRequest(BaseModel):
    invite_code: str = Field(min_length=4, max_length=20)


def require_client() -> Client:
    if client is None:
        raise HTTPException(status_code=503, detail="Supabase server environment is not configured")
    return client


def token_from_header(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    db = require_client()
    token = token_from_header(authorization)
    try:
        result = db.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid session token") from exc
    user = getattr(result, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session token")
    return {"id": user.id, "email": getattr(user, "email", None)}


def require_profile_access(profile_id: str, user: dict[str, Any], db: Client) -> None:
    own = db.table("companion_profiles").select("id").eq("id", profile_id).eq("auth_user_id", user["id"]).execute().data or []
    if own:
        return
    linked = db.table("companion_caregiver_links").select("id").eq("senior_profile_id", profile_id).eq("caregiver_user_id", user["id"]).execute().data or []
    if linked:
        return
    raise HTTPException(status_code=403, detail="You do not have access to this profile")


def select_one(table: str, item_id: str, profile_id: str, db: Client) -> dict[str, Any]:
    rows = db.table(table).select("*").eq("id", item_id).eq("profile_id", profile_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Item not found")
    return rows[0]


@app.get("/health")
def health():
    return {"status": "ok", "service": "reverie-companion-api"}


@app.get("/")
def root():
    return health()


@app.get("/profiles/me")
def profile_me(user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    profile = db.table("companion_profiles").select("*").eq("auth_user_id", user["id"]).maybe_single().execute().data
    caregiver_links = db.table("companion_caregiver_links").select("*, companion_profiles(*)").eq("caregiver_user_id", user["id"]).execute().data or []
    return {"user": user, "profile": profile, "caregiver_links": caregiver_links}


@app.post("/profiles/me")
def create_profile(payload: ProfileCreateRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    result = db.table("companion_profiles").upsert({
        "auth_user_id": user["id"],
        "display_name": payload.display_name,
    }, on_conflict="auth_user_id").select("*").single().execute()
    return {"profile": result.data}


@app.patch("/profiles/{profile_id}")
def update_profile(profile_id: str, payload: ProfileUpdateRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    patch = payload.model_dump(exclude_unset=True)
    result = db.table("companion_profiles").update(patch).eq("id", profile_id).select("*").single().execute()
    return {"profile": result.data}


@app.get("/profiles/{profile_id}/summary")
def profile_summary(profile_id: str, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    today = date.today().isoformat()
    return {
        "memories": len(db.table("companion_memories").select("id").eq("profile_id", profile_id).execute().data or []),
        "object_locations": len(db.table("companion_object_locations").select("id").eq("profile_id", profile_id).execute().data or []),
        "photo_cards": len(db.table("companion_photo_cards").select("id").eq("profile_id", profile_id).execute().data or []),
        "today_reminders": len(db.table("companion_reminders").select("id").eq("profile_id", profile_id).eq("scheduled_date", today).execute().data or []),
    }


@app.get("/profiles/{profile_id}/dashboard")
def profile_dashboard(profile_id: str, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    today = date.today().isoformat()
    return {
        "memories": db.table("companion_memories").select("*").eq("profile_id", profile_id).order("created_at", desc=True).limit(25).execute().data or [],
        "object_locations": db.table("companion_object_locations").select("*").eq("profile_id", profile_id).order("last_confirmed_at", desc=True).execute().data or [],
        "daily_board": db.table("companion_daily_board_items").select("*").eq("profile_id", profile_id).eq("board_date", today).order("scheduled_time").execute().data or [],
        "reminders": db.table("companion_reminders").select("*").eq("profile_id", profile_id).gte("scheduled_date", today).order("scheduled_date").order("scheduled_time").execute().data or [],
        "photo_cards": db.table("companion_photo_cards").select("*").eq("profile_id", profile_id).order("name").execute().data or [],
        "emergency_contacts": db.table("companion_emergency_contacts").select("*").eq("profile_id", profile_id).order("sort_order").execute().data or [],
    }


@app.post("/profiles/{profile_id}/memories")
def create_memory(profile_id: str, payload: MemoryRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    result = db.table("companion_memories").insert({
        "profile_id": profile_id,
        "title": payload.title,
        "body": payload.body,
        "memory_type": payload.memory_type,
        "created_by": user["id"],
    }).select("*").single().execute()
    return {"memory": result.data}


@app.post("/profiles/{profile_id}/object-locations")
def create_object_location(profile_id: str, payload: ObjectLocationRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    result = db.table("companion_object_locations").insert({
        "profile_id": profile_id,
        "object_name": payload.object_name,
        "location_text": payload.location_text,
        "photo_url": payload.photo_url,
        "created_by": user["id"],
    }).select("*").single().execute()
    return {"object_location": result.data}


@app.post("/profiles/{profile_id}/daily-board")
def create_daily_board(profile_id: str, payload: DailyBoardRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    result = db.table("companion_daily_board_items").insert({
        "profile_id": profile_id,
        "board_date": payload.board_date.isoformat(),
        "label": payload.label,
        "detail": payload.detail,
        "scheduled_time": payload.scheduled_time.isoformat() if payload.scheduled_time else None,
        "item_type": payload.item_type,
        "created_by": user["id"],
    }).select("*").single().execute()
    return {"item": result.data}


@app.post("/profiles/{profile_id}/reminders")
def create_reminder(profile_id: str, payload: ReminderRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    result = db.table("companion_reminders").insert({
        "profile_id": profile_id,
        "title": payload.title,
        "detail": payload.detail,
        "category": payload.category,
        "scheduled_date": payload.scheduled_date.isoformat(),
        "scheduled_time": payload.scheduled_time.isoformat(),
        "repeat_rule": payload.repeat_rule,
        "escalation_minutes": payload.escalation_minutes,
        "caregiver_escalation_enabled": payload.caregiver_escalation_enabled,
        "created_by": user["id"],
    }).select("*").single().execute()
    return {"reminder": result.data}


@app.post("/profiles/{profile_id}/reminders/{reminder_id}/acknowledge")
def acknowledge_reminder(profile_id: str, reminder_id: str, payload: ReminderAcknowledgeRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    select_one("companion_reminders", reminder_id, profile_id, db)
    now = datetime.now(timezone.utc).isoformat()
    ack_result = db.table("companion_reminder_acknowledgements").insert({
        "reminder_id": reminder_id,
        "profile_id": profile_id,
        "status": payload.status,
        "acknowledged_at": now,
    }).select("*").single().execute()
    db.table("companion_reminders").update({
        "last_acknowledged_at": now,
        "last_acknowledgement_status": payload.status,
    }).eq("id", reminder_id).execute()
    return {"acknowledgement": ack_result.data}


@app.post("/profiles/{profile_id}/photo-cards")
def create_photo_card(profile_id: str, payload: PhotoCardRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    result = db.table("companion_photo_cards").insert({
        "profile_id": profile_id,
        "name": payload.name,
        "relationship": payload.relationship,
        "note": payload.note,
        "image_url": payload.image_url,
        "created_by": user["id"],
    }).select("*").single().execute()
    return {"photo_card": result.data}


@app.post("/profiles/{profile_id}/emergency-contacts")
def create_emergency_contact(profile_id: str, payload: EmergencyContactRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    result = db.table("companion_emergency_contacts").insert({
        "profile_id": profile_id,
        "name": payload.name,
        "relationship": payload.relationship,
        "phone": payload.phone,
        "sort_order": payload.sort_order,
    }).select("*").single().execute()
    return {"contact": result.data}


@app.post("/profiles/{profile_id}/caregivers/invite")
def create_caregiver_invite(profile_id: str, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    code = os.urandom(4).hex().upper()
    expires_at = datetime.now(timezone.utc).replace(microsecond=0).timestamp() + 7 * 24 * 60 * 60
    expires_iso = datetime.fromtimestamp(expires_at, timezone.utc).isoformat()
    result = db.table("companion_caregiver_invites").insert({
        "senior_profile_id": profile_id,
        "invite_code": code,
        "expires_at": expires_iso,
    }).select("*").single().execute()
    return {"invite": result.data}


@app.post("/caregivers/accept")
def accept_caregiver_invite(payload: InviteAcceptRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    rows = db.table("companion_caregiver_invites").select("*").eq("invite_code", payload.invite_code.upper()).is_("accepted_at", "null").execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Invite code was not found")
    invite = rows[0]
    db.table("companion_caregiver_links").insert({
        "senior_profile_id": invite["senior_profile_id"],
        "caregiver_user_id": user["id"],
        "role": "caregiver",
    }).execute()
    db.table("companion_caregiver_invites").update({"accepted_at": datetime.now(timezone.utc).isoformat()}).eq("id", invite["id"]).execute()
    return {"accepted": True}


@app.post("/devices/register")
def register_device(payload: DeviceRegisterRequest, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    if payload.profile_id:
        require_profile_access(payload.profile_id, user, db)
    result = db.table("companion_device_tokens").upsert({
        "auth_user_id": user["id"],
        "profile_id": payload.profile_id,
        "platform": payload.platform,
        "token": payload.token,
        "enabled": payload.enabled,
    }, on_conflict="auth_user_id,token").select("*").single().execute()
    return {"device": result.data}


@app.post("/notifications/run-escalations")
def run_escalations(request: Request):
    expected = os.getenv("ESCALATION_SECRET")
    if expected and request.headers.get("x-escalation-secret") != expected:
        raise HTTPException(status_code=401, detail="Invalid escalation secret")
    db = require_client()
    today = date.today().isoformat()
    reminders = db.table("companion_reminders").select("*").lte("scheduled_date", today).is_("last_acknowledged_at", "null").eq("caregiver_escalation_enabled", True).execute().data or []
    queued = 0
    for reminder in reminders:
        event_key = f"{reminder['scheduled_date']}:{reminder['scheduled_time']}:missed"
        try:
            db.table("companion_notification_events").insert({
                "reminder_id": reminder["id"],
                "profile_id": reminder["profile_id"],
                "event_key": event_key,
                "status": "queued",
                "payload": {"title": reminder["title"], "detail": reminder.get("detail")},
            }).execute()
            queued += 1
        except Exception:
            continue
    return {"queued": queued, "delivery": "queued_only_until_fcm_credentials_are_configured"}


@app.get("/profiles/{profile_id}/search")
def search(profile_id: str, q: str, user: dict[str, Any] = Depends(current_user)):
    db = require_client()
    require_profile_access(profile_id, user, db)
    term = f"%{q}%"
    memories = db.table("companion_memories").select("*").eq("profile_id", profile_id).or_(f"title.ilike.{term},body.ilike.{term}").limit(20).execute().data or []
    objects = db.table("companion_object_locations").select("*").eq("profile_id", profile_id).or_(f"object_name.ilike.{term},location_text.ilike.{term}").limit(20).execute().data or []
    photos = db.table("companion_photo_cards").select("*").eq("profile_id", profile_id).or_(f"name.ilike.{term},relationship.ilike.{term},note.ilike.{term}").limit(20).execute().data or []
    reminders = db.table("companion_reminders").select("*").eq("profile_id", profile_id).or_(f"title.ilike.{term},detail.ilike.{term},category.ilike.{term}").limit(20).execute().data or []
    answer = "I could not find that yet. You can save it or ask a caregiver to add it."
    if objects:
        answer = f"Your {objects[0]['object_name']} is {objects[0]['location_text']}."
    elif memories:
        answer = memories[0]["body"]
    elif photos:
        answer = f"{photos[0]['name']}: {photos[0].get('note') or photos[0].get('relationship') or ''}".strip()
    elif reminders:
        answer = f"{reminders[0]['title']} is scheduled for {reminders[0]['scheduled_date']} at {reminders[0]['scheduled_time']}."
    return {"answer": answer, "memories": memories, "object_locations": objects, "photo_cards": photos, "reminders": reminders}
