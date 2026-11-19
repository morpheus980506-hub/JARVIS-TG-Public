from uuid import uuid4
from sqlalchemy import update

from app.database.db import ApprovalRecord, SessionLocal
from app.schemas.domain import ApprovalLevel, ApprovalRequest


class ApprovalManager:
    async def request(self, payload: ApprovalRequest) -> ApprovalRecord:
        status = "AUTHORIZED" if payload.level == ApprovalLevel.L1 else "PENDING_APPROVAL"
        record = ApprovalRecord(
            id=uuid4().hex,
            trip_id=payload.trip_id,
            action=payload.action,
            level=payload.level.value,
            status=status,
            payload=payload.model_dump(mode="json"),
        )
        async with SessionLocal() as session:
            session.add(record)
            await session.commit()
            await session.refresh(record)
        return record

    async def decide(self, approval_id: str, approved: bool, reason: str) -> ApprovalRecord | None:
        async with SessionLocal() as session:
            record = await session.get(ApprovalRecord, approval_id)
            if not record:
                return None
            if record.status != "PENDING_APPROVAL":
                raise ValueError("Approval is no longer pending")
            result=await session.execute(update(ApprovalRecord).where(
                ApprovalRecord.id==approval_id,ApprovalRecord.status=='PENDING_APPROVAL'
            ).values(status='AUTHORIZED' if approved else 'REJECTED',
                     payload={**record.payload,'decision_reason':reason}).execution_options(synchronize_session=False))
            if result.rowcount!=1:raise ValueError('Approval is no longer pending')
            await session.commit()
            await session.refresh(record)
            return record

