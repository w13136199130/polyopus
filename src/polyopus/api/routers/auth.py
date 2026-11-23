"""Auth endpoints: login / refresh / reauth / MFA / me / logout (V1-03)."""

from __future__ import annotations

import json
import time
from sqlite3 import Connection

from fastapi import APIRouter, Depends, Request, Response
from pydantic import AliasChoices, BaseModel, Field

from polyopus.api.deps import (
    COOKIE_NAME,
    REFRESH_COOKIE,
    current_session,
    current_user,
    get_db,
    require_step_up,
)
from polyopus.domains.identity import mfa, rbac
from polyopus.domains.identity.service import (
    Session,
    User,
    authenticate,
    create_session,
    mark_step_up,
    revoke_session,
    rotate_session,
)
from polyopus.platform.errors import AppError
from polyopus.platform.security import tokens

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    tenant: str | None = Field(default=None, max_length=64)
    mfa_code: str | None = Field(
        default=None, validation_alias=AliasChoices("mfa_code", "mfaCode")
    )


class RefreshBody(BaseModel):
    refresh_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("refresh_token", "refreshToken"),
    )


class UpdateMeBody(BaseModel):
    display_name: str | None = Field(
        default=None, min_length=1, max_length=64,
        validation_alias=AliasChoices("displayName", "display_name"),
    )
    notification_prefs: dict[str, bool] | None = Field(
        default=None,
        validation_alias=AliasChoices("notificationPrefs", "notification_prefs"),
    )


class ReauthBody(BaseModel):
    password: str = Field(min_length=1)
    mfa_code: str | None = Field(
        default=None, validation_alias=AliasChoices("mfa_code", "mfaCode")
    )


class MfaCodeBody(BaseModel):
    code: str = Field(min_length=4, max_length=32)


def _user_payload(user: User) -> dict[str, object]:
    return {
        "userId": user.user_id,
        "tenantId": user.tenant_id,
        "username": user.username,
        "displayName": user.display_name,
        "isOwner": user.is_owner,
        "roles": list(user.roles),
        "permissions": list(user.permissions),
        "notificationPrefs": user.preferences.get("notifications", {}),
    }


def _set_cookies(
    response: Response, *, access: str, refresh: str, access_ttl: int,
) -> None:
    response.set_cookie(
        COOKIE_NAME, access, httponly=True, samesite="lax", max_age=access_ttl,
    )
    response.set_cookie(
        REFRESH_COOKIE, refresh, httponly=True, samesite="lax",
        max_age=30 * 86400, path="/api/v1/auth",
    )


def _issue_access(request: Request, session_id: str, user: User) -> str:
    settings = request.app.state.settings
    return tokens.issue(
        settings.secret_key,
        {"sid": session_id, "uid": user.user_id, "tid": user.tenant_id},
        settings.access_ttl_seconds,
    )


def _require_mfa(conn: Connection, user: User, code: str | None) -> None:
    if not mfa.is_enabled(conn, user):
        return
    if not code or not mfa.verify_code(conn, user, code):
        raise AppError("AUTH_FAILED", details={"mfaRequired": True})


@router.post("/login")
def login(
    body: LoginBody,
    request: Request,
    response: Response,
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    settings = request.app.state.settings
    user = rbac.with_permissions(
        conn,
        authenticate(
            conn, body.username, body.password,
            tenant_id=body.tenant or "default",
        ),
    )
    _require_mfa(conn, user, body.mfa_code)
    session_id, refresh = create_session(
        conn,
        user,
        ttl_seconds=settings.session_ttl_seconds,
        user_agent=request.headers.get("User-Agent"),
        ip=request.client.host if request.client else None,
    )
    access = _issue_access(request, session_id, user)
    _set_cookies(
        response, access=access, refresh=refresh,
        access_ttl=settings.access_ttl_seconds,
    )
    return {
        "accessToken": access,
        "refreshToken": refresh,
        "expiresIn": settings.access_ttl_seconds,
        "user": _user_payload(user),
    }


@router.post("/refresh")
def refresh(
    body: RefreshBody,
    request: Request,
    response: Response,
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    settings = request.app.state.settings
    token = body.refresh_token or request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise AppError("UNAUTHORIZED")
    session_id, new_refresh, user = rotate_session(
        conn, token,
        ttl_seconds=settings.session_ttl_seconds,
        user_agent=request.headers.get("User-Agent"),
        ip=request.client.host if request.client else None,
    )
    user = rbac.with_permissions(conn, user)
    access = _issue_access(request, session_id, user)
    _set_cookies(
        response, access=access, refresh=new_refresh,
        access_ttl=settings.access_ttl_seconds,
    )
    return {
        "accessToken": access,
        "refreshToken": new_refresh,
        "expiresIn": settings.access_ttl_seconds,
    }


@router.post("/reauth")
def reauth(
    body: ReauthBody,
    request: Request,
    response: Response,
    session: Session = Depends(current_session),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    if session.api_key:
        raise AppError("REAUTH_REQUIRED")
    user = authenticate(
        conn, session.user.username, body.password,
        tenant_id=session.user.tenant_id,
    )
    _require_mfa(conn, user, body.mfa_code)
    until = mark_step_up(conn, session.session_id)
    access = _issue_access(request, session.session_id, session.user)
    response.set_cookie(
        COOKIE_NAME, access, httponly=True, samesite="lax",
        max_age=request.app.state.settings.access_ttl_seconds,
    )
    return {
        "accessToken": access,
        "grantToken": access,
        "expiresAt": until,
        "scope": ["step_up"],
    }


@router.post("/mfa/totp/enroll")
def mfa_enroll(
    session: Session = Depends(current_session),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    if session.api_key:
        raise AppError("FORBIDDEN")
    return {**mfa.enroll(conn, session.user), "recoveryCodes": []}


@router.post("/mfa/totp/verify")
def mfa_verify(
    body: MfaCodeBody,
    session: Session = Depends(current_session),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    if session.api_key:
        raise AppError("FORBIDDEN")
    try:
        codes = mfa.confirm_enrollment(conn, session.user, body.code)
    except ValueError as exc:
        raise AppError("AUTH_FAILED", details={"reason": str(exc)}) from exc
    return {"enabled": True, "recoveryCodes": codes}


@router.delete("/mfa/{method}")
def mfa_disable(
    method: str,
    session: Session = Depends(require_step_up),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    if method != "totp":
        raise AppError("NOT_FOUND", details={"method": method})
    mfa.disable(conn, session.user)
    return {"enabled": False, "methods": [], "recoveryCodesRemaining": 0}


@router.get("/me")
def me(
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    return {"user": {**_user_payload(user), "mfaEnabled": mfa.is_enabled(conn, user)}}


@router.patch("/me")
def update_me(
    body: UpdateMeBody,
    user: User = Depends(current_user),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    if body.display_name is None and body.notification_prefs is None:
        raise AppError(
            "VALIDATION_FAILED", details={"fields": {"displayName": "required"}}
        )
    clean = user.display_name
    if body.display_name is not None:
        clean = body.display_name.strip()
        if not clean:
            raise AppError(
                "VALIDATION_FAILED", details={"fields": {"displayName": "required"}}
            )
    preferences = dict(user.preferences)
    if body.notification_prefs is not None:
        current = preferences.get("notifications")
        merged = dict(current) if isinstance(current, dict) else {}
        merged.update(body.notification_prefs)
        preferences["notifications"] = merged
    conn.execute(
        "UPDATE users SET display_name = ?, preferences_json = ?, updated_at = ? "
        "WHERE tenant_id = ? AND user_id = ?",
        (clean, json.dumps(preferences, ensure_ascii=False), int(time.time()),
         user.tenant_id, user.user_id),
    )
    conn.commit()
    return {
        "user": {
            **_user_payload(user),
            "displayName": clean,
            "notificationPrefs": preferences.get("notifications", {}),
            "mfaEnabled": mfa.is_enabled(conn, user),
        },
    }


@router.post("/logout")
def logout(
    response: Response,
    session: Session = Depends(current_session),
    conn: Connection = Depends(get_db),
) -> dict[str, object]:
    if not session.api_key:
        revoke_session(conn, session.session_id)
    response.delete_cookie(COOKIE_NAME)
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")
    return {"ok": True}
