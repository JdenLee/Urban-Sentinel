"""The deployed feature set: façade history + DOB violations + ECB violations + building attributes.

Chosen by the Step 2 ablation (reports/ABLATION.md): each kept source improved cycle-9 PR-AUC with a paired
bootstrap CI excluding zero; complaints did not and are left out.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from .features import build_features
from .ingest import load_facades
from .sources import building_attributes, event_features, load_events

DEPLOYED_PARTS = ("dob", "ecb", "bldg")


@dataclass
class Context:
    fac: pd.DataFrame
    events: dict = field(default_factory=dict)

    @classmethod
    def load(cls, refresh: bool = False, with_events: bool = True) -> "Context":
        return cls(load_facades(refresh=refresh), load_events(refresh=refresh) if with_events else {})

    def restricted_to(self, bins) -> "Context":
        """Records for a few buildings only (every feature is computed per building)."""
        keep = set(bins)
        return Context(self.fac[self.fac["bin"].isin(keep)],
                       {k: v[v["bin"].isin(keep)] for k, v in self.events.items()})


def extra_features(ctx: Context, bins, cutoff, parts) -> pd.DataFrame:
    blocks = []
    srcs = tuple(p for p in parts if p in ("dob", "ecb", "cmp"))
    if srcs:
        blocks.append(event_features(ctx.events, bins, cutoff, echo_buffer_days=90 if "buffer" in parts else 0,
                                     sources=srcs))
    if "bldg" in parts:
        blocks.append(building_attributes(ctx.fac, bins, cutoff))
    return pd.concat(blocks, axis=1) if blocks else pd.DataFrame(index=pd.Index(bins, name="bin"))


def feature_matrix(ctx: Context, bins, cutoff, target_cycle: int, parts=DEPLOYED_PARTS) -> pd.DataFrame:
    X = build_features(ctx.fac, bins, cutoff, target_cycle)
    return pd.concat([X, extra_features(ctx, X.index, cutoff, parts)], axis=1)
