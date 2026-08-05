"""rename device_sessions last_seen_at to last_used_at

Revision ID: a89b019603e3
Revises: df2e9dfdd6c7
Create Date: 2026-07-29 19:59:26.497697

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a89b019603e3'
down_revision: Union[str, None] = 'df2e9dfdd6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite has no direct RENAME COLUMN before 3.25; batch_alter_table
    # (enabled via render_as_batch in env.py) handles it portably, and on
    # PostgreSQL this emits a clean ALTER TABLE ... RENAME COLUMN.
    with op.batch_alter_table('device_sessions', schema=None) as batch_op:
        batch_op.alter_column('last_seen_at', new_column_name='last_used_at')


def downgrade() -> None:
    with op.batch_alter_table('device_sessions', schema=None) as batch_op:
        batch_op.alter_column('last_used_at', new_column_name='last_seen_at')
