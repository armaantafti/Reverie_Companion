import os
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVER_DB_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")]

app = FastAPI(title="Reverie Companion API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = create_client(SUPABASE_URL, SERVER_DB_KEY) if SUPABASE_URL and SERVER_DB_KEY else None


class ReminderAcknowledgeRequest(BaseModel):
    reminder_id: str
    profile_id: str
    status: Literal["done", "skipped", "needs_help"] = "done"


class DailySummaryRequest(BaseModel):
    profile_id: str
    date: str = Field(description="ISO date, e.g. 2026-05-19")


class CompanionMemoryRequest(BaseModel):
    profile_id: str
    title: str
    body: str
    memory_type: Literal["general", "where_kept", "person", "routine", "medical"] = "general"


def require_client():
    if client is None:
        raise HTTPException(status_code=503, detail="Supabase server environment is not configured")
    return client


@app.get("/health")
def health():
    return {"status": "ok", "service": "reverie-companion-api"}


@app.post("/memories")
def create_memory(payload: CompanionMemoryRequest):
    db = require_client()
    result = db.table("companion_memories").insert({
        "profile_id": payload.profile_id,
        "title": payload.title,
        "body": payload.body,
        "memory_type": payload.memory_type,
    }).execute()
    return {"memory": result.data[0] if result.data else None}


@app.post("/reminders/acknowledge")
def acknowledge_reminder(payload: ReminderAcknowledgeRequest):
    db = require_client()
    now = datetime.now(timezone.utc).isoformat()
    ack_result = db.table("companion_reminder_acknowledgements").insert({
        "reminder_id": payload.reminder_id,
        "profile_id": payload.profile_id,
        "status": payload.status,
        "acknowledged_at": now,
    }).execute()
    db.table("companion_reminders").update({
        "last_acknowledged_at": now,
        "last_acknowledgement_status": payload.status,
    }).eq("id", payload.reminder_id).execute()
    return {"acknowledgement": ack_result.data[0] if ack_result.data else None}


@app.post("/daily-summary")
def daily_summary(payload: DailySummaryRequest):
    db = require_client()
    board = db.table("companion_daily_board_items").select("*").eq("profile_id", payload.profile_id).eq("board_date", payload.date).execute().data or []
    reminders = db.table("companion_reminders").select("*").eq("profile_id", payload.profile_id).eq("scheduled_date", payload.date).execute().data or []
    missed = [item for item in reminders if not item.get("last_acknowledged_at")]
    return {
        "date": payload.date,
        "board_items": board,
        "reminders": reminders,
        "caregiver_summary": {
            "total_board_items": len(board),
            "total_reminders": len(reminders),
            "missed_or_pending_reminders": len(missed),
            "message": "Review pending reminders and add reassurance notes if needed." if missed else "No pending reminders recorded."
        }
    }
