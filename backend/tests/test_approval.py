from app.schemas.domain import ApprovalLevel


def test_transaction_actions_are_l3() -> None:
    assert ApprovalLevel.L3.value == "L3"

