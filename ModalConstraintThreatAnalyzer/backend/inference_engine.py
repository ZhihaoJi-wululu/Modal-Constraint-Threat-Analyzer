from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any


MODAL_CODE = {
    "Obligation": "M",
    "Permission": "S",
    "Recommendation": "Sh",
    "Ability": "C",
}

MODAL_NAME = {
    "M": "Obligation",
    "S": "Permission",
    "Sh": "Recommendation",
    "C": "Ability",
}

POLARITY_NAME = {
    "p": "Positive",
    "n": "Negative",
}


def modal_predicate_from_parts(modal: str, polarity: str) -> str:
    return f"modal_constraint_{modal}_{polarity}"


def normalize_node(node: dict[str, Any]) -> dict[str, Any]:
    copy = dict(node)
    if copy.get("type") == "Agent":
        copy["type"] = "Actor"
    return copy


MODAL_RELATION_META = {
    "modal_M_P": {"label": "M,P", "modal": "M", "polarity": "p", "punish": False},
    "modal_M_N": {"label": "M,N", "modal": "M", "polarity": "n", "punish": False},
    "modal_S_P": {"label": "S,P", "modal": "S", "polarity": "p", "punish": False},
    "modal_S_N": {"label": "S,N", "modal": "S", "polarity": "n", "punish": False},
    "modal_Sh_P": {"label": "Sh,P", "modal": "Sh", "polarity": "p", "punish": False},
    "modal_Sh_N": {"label": "Sh,N", "modal": "Sh", "polarity": "n", "punish": False},
    "modal_C_P": {"label": "C,P", "modal": "C", "polarity": "p", "punish": False},
    "modal_C_N": {"label": "C,N", "modal": "C", "polarity": "n", "punish": False},
    "modal_M_P_Y": {"label": "M,P,Y", "modal": "M", "polarity": "p", "punish": True},
    "modal_M_N_Y": {"label": "M,N,Y", "modal": "M", "polarity": "n", "punish": True},
    "modal_S_P_Y": {"label": "S,P,Y", "modal": "S", "polarity": "p", "punish": True},
    "modal_S_N_Y": {"label": "S,N,Y", "modal": "S", "polarity": "n", "punish": True},
}

POSITIVE_ACCESS_MODAL_PREDICATES = {
    *[modal_predicate_from_parts(modal, "p") for modal in ("M", "S", "C")]
}
NEGATIVE_BOUNDARY_MODAL_PREDICATES = {
    *[modal_predicate_from_parts(modal, "n") for modal in ("C", "S")]
}
RECOMMENDATION_MODAL_PREDICATES = {
    *[modal_predicate_from_parts(modal, "p") for modal in ("Sh", "S")]
}
OWNERSHIP_MODAL_PREDICATES = {
    *[modal_predicate_from_parts(modal, "p") for modal in ("S", "M")]
}


@dataclass(frozen=True)
class Fact:
    predicate: str
    args: tuple[str, ...]
    source: str

    def key(self) -> tuple[str, tuple[str, ...]]:
        return self.predicate, self.args

    def to_dict(self) -> dict[str, Any]:
        return {"predicate": self.predicate, "args": list(self.args), "source": self.source}


@dataclass(frozen=True)
class Finding:
    threatType: str
    riskLevel: str
    evidence: str
    ruleId: str
    kind: str
    victimRole: str = ""
    attacker: str = ""
    asset: str = ""
    technique: str = ""
    modalTrigger: str = ""

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


class FactStore:
    def __init__(self) -> None:
        self._facts: dict[tuple[str, tuple[str, ...]], Fact] = {}

    def add(self, predicate: str, args: list[str] | tuple[str, ...], source: str) -> None:
        fact = Fact(predicate=predicate, args=tuple(args), source=source)
        self._facts[fact.key()] = fact

    def all(self) -> list[Fact]:
        return sorted(self._facts.values(), key=lambda fact: (fact.predicate, fact.args, fact.source))

    def size(self) -> int:
        return len(self._facts)


class InferenceEngine:
    def __init__(self, model: dict[str, Any]) -> None:
        self.model = model
        self.nodes = [normalize_node(node) for node in model.get("nodes", [])]
        self.edges = model.get("edges", [])
        self.node_index = {node.get("id"): node for node in self.nodes}

    def infer(self, include_scenario_rules: bool = True) -> dict[str, Any]:
        store = self.build_facts(include_scenario_rules=include_scenario_rules)
        facts = store.all()
        findings = self.detect_threats(facts) if include_scenario_rules else []
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "facts": [fact.to_dict() for fact in facts],
            "findings": [finding.to_dict() for finding in findings],
            "summary": {
                "nodeCount": len(self.nodes),
                "edgeCount": len(self.edges),
                "factCount": len(facts),
                "findingCount": len(findings),
            },
        }

    def validate(self) -> list[Finding]:
        messages: list[Finding] = []
        roles = self.by_type("Role")
        assets = self.by_type("Asset")
        constraints = self.by_type("Constraint")
        has_modal_relationships = bool(constraints) or any(is_modal_relation_type(edge.get("type", "")) for edge in self.edges)
        has_actor_play_role = any(
            edge.get("type") == "plays"
            and self.node_index.get(edge.get("from"), {}).get("type") == "Actor"
            and self.node_index.get(edge.get("to"), {}).get("type") == "Role"
            for edge in self.edges
        )

        def notice(message: str) -> None:
            messages.append(Finding("Model Validation", "Notice", message, "VALIDATION", "notice"))

        if not roles:
            notice("Add at least one Role.")
        if len(roles) < 2:
            notice("Add at least two Roles so one can be evaluated as attacker and another as victim.")
        if not has_actor_play_role:
            notice("Connect an Actor to the Role being evaluated with play.")
        if not assets:
            notice("Add at least one Asset.")
        if not has_modal_relationships:
            notice("Add at least one modal relationship.")
        if not self.edges:
            notice("Add relations between modeling elements.")
        for constraint in constraints:
            if not self.connected(constraint["id"], "appliesTo"):
                notice(f"{constraint.get('name', constraint['id'])} should connect to a Role with appliesTo.")
            if not self.connected(constraint["id"], "constrains"):
                notice(f"{constraint.get('name', constraint['id'])} should connect to a Task or Asset with constrains.")

        if not messages:
            messages.append(
                Finding(
                    "Model Validation",
                    "Ready",
                    "The model contains the required roles, assets, modal relationships, and relations.",
                    "VALIDATION",
                    "ready",
                )
            )
        return messages

    def build_facts(self, include_scenario_rules: bool) -> FactStore:
        store = FactStore()
        for node in self.nodes:
            node_id = node.get("id", "")
            node_type = node.get("type", "")
            if not node_id:
                continue
            store.add("node", [node_id, node_type], "Model")
            if node_type == "Actor" and node.get("awareness"):
                store.add("has_security_awareness", [node_id, level_code(node["awareness"])], "Model")
            if node_type == "Scenario" and node.get("complexity"):
                store.add("scene", [node_id, level_code(node["complexity"])], "Model")

        for edge in self.edges:
            if edge.get("from") in self.node_index and edge.get("to") in self.node_index:
                if is_modal_relation_type(edge.get("type", "")):
                    continue
                store.add(relation_predicate(edge.get("type", "")), [edge["from"], edge["to"]], "Model")

        for edge in self.edges:
            modal = self.modal_relation_fact(edge)
            if not modal:
                continue
            store.add(modal["predicate"], [modal["role"]["id"], modal["action"], modal["target"]["id"]], modal["source"])
            store.add(modal["predicate"], [modal["role"]["id"], modal["target"]["id"]], modal["source"])
            if modal["punish"]:
                store.add("punishment", [modal["role"]["id"], modal["target"]["id"]], modal["source"])

        for edge in self.edges:
            if edge.get("type") != "plays":
                continue
            first = self.node_index.get(edge.get("from"))
            second = self.node_index.get(edge.get("to"))
            agent = first if first and first.get("type") == "Actor" else second if second and second.get("type") == "Actor" else None
            role = first if first and first.get("type") == "Role" else second if second and second.get("type") == "Role" else None
            if agent and role and agent.get("awareness"):
                store.add("has_security_awareness", [role["id"], level_code(agent["awareness"])], "Model")

        for constraint in self.by_type("Constraint"):
            roles = [node for node in self.connected(constraint["id"], "appliesTo") if node.get("type") == "Role"]
            targets = [
                node for node in self.connected(constraint["id"], "constrains")
                if node.get("type") in {"Task", "Asset"}
            ]
            for role in roles:
                for target in targets:
                    action = (constraint.get("actionType") or ("Execute" if target.get("type") == "Task" else "Possess")).lower()
                    predicate = modal_predicate(constraint)
                    source = f"Constraint:{constraint.get('name', constraint['id'])}"
                    store.add(predicate, [role["id"], action, target["id"]], source)
                    store.add(predicate, [role["id"], target["id"]], source)
                    if is_uncertain_constraint(constraint):
                        store.add("uncertain_constraint", [role["id"], target["id"]], source)

        if include_scenario_rules:
            self.apply_scenario_rules(store)
        return store

    def apply_scenario_rules(self, store: FactStore) -> None:
        guard = 0
        changed = True
        while changed and guard < 8:
            guard += 1
            before = store.size()
            facts = store.all()

            for first in by_predicate(facts, "subordinate"):
                for second in by_predicate(facts, "subordinate"):
                    if second.args[0] == first.args[1]:
                        store.add("subordinate", [first.args[0], second.args[1]], "SR1")

            for fact in modal_facts(facts):
                role = fact.args[0]
                if modal_predicate_is(fact.predicate, "M", "p"):
                    store.add(derived_modal_predicate(fact, "S", "p"), fact.args, "SR2-SR3")
                    self.add_punishment_for_derived(facts, store, fact.args[0], fact.args[-1], fact.args[0], fact.args[-1], "SR2-SR3")
                if modal_predicate_is(fact.predicate, "S", "p"):
                    store.add(derived_modal_predicate(fact, "C", "p"), fact.args, "SR4-SR5")
                    self.add_punishment_for_derived(facts, store, fact.args[0], fact.args[-1], fact.args[0], fact.args[-1], "SR4-SR5")
                if modal_predicate_is(fact.predicate, "Sh", "p"):
                    store.add(derived_modal_predicate(fact, "S", "p"), fact.args, "SR13-SR14")
                    store.add(derived_modal_predicate(fact, "C", "p"), fact.args, "SR11-SR12")
                    self.add_punishment_for_derived(facts, store, fact.args[0], fact.args[-1], fact.args[0], fact.args[-1], "SR13-SR14")
                    self.add_punishment_for_derived(facts, store, fact.args[0], fact.args[-1], fact.args[0], fact.args[-1], "SR11-SR12")

            for fact in by_predicate(facts, "ownership") + by_predicate(facts, "owns") + by_predicate(facts, "possesses"):
                predicate = modal_predicate_from_parts("S", "p")
                store.add(predicate, [fact.args[0], "possess", fact.args[1]], "SR10")
                store.add(predicate, [fact.args[0], fact.args[1]], "SR10")

            for fact in modal_facts(facts):
                if len(fact.args) != 3 or fact.args[1] != "execute" or not (modal_predicate_is(fact.predicate, "M", "p") or modal_predicate_is(fact.predicate, "S", "p")):
                    continue
                for dependency in (
                    by_predicate(facts, "need")
                    + by_predicate(facts, "generate")
                    + by_predicate(facts, "depend")
                    + by_predicate(facts, "needs")
                    + by_predicate(facts, "generates")
                    + by_predicate(facts, "depends")
                ):
                    if dependency.args[0] == fact.args[2]:
                        predicate = derived_modal_predicate(fact, "S", "p")
                        store.add(predicate, [fact.args[0], "possess", dependency.args[1]], "SR6-SR9")
                        store.add(predicate, [fact.args[0], dependency.args[1]], "SR6-SR9")
                        self.add_punishment_for_derived(facts, store, fact.args[0], fact.args[2], fact.args[0], dependency.args[1], "SR6-SR9")

            for fact in modal_facts(facts):
                if len(fact.args) != 3:
                    continue
                source_role, action, obj = fact.args
                for delegation in by_predicate(facts, "delegatePermission") + by_predicate(facts, "delegates"):
                    if delegation.args[0] == source_role and modal_predicate_is_positive(fact.predicate) and not modal_predicate_is(fact.predicate, "M", "p"):
                        predicate = derived_modal_predicate(fact, "S", "p")
                        store.add(predicate, [delegation.args[1], action, obj], "SR15-SR17")
                        store.add(predicate, [delegation.args[1], obj], "SR15-SR17")
                        self.add_punishment_for_derived(facts, store, source_role, obj, delegation.args[1], obj, "SR15-SR17")
                for delegation in by_predicate(facts, "delegateObligation"):
                    if delegation.args[0] == source_role and modal_predicate_is(fact.predicate, "M", "p"):
                        predicate = derived_modal_predicate(fact, "M", "p")
                        store.add(predicate, [delegation.args[1], action, obj], "SR16-SR18")
                        store.add(predicate, [delegation.args[1], obj], "SR16-SR18")
                        self.add_punishment_for_derived(facts, store, source_role, obj, delegation.args[1], obj, "SR16-SR18")

            changed = store.size() > before

    def add_punishment_for_derived(
        self,
        facts: list[Fact],
        store: FactStore,
        source_role: str,
        source_target: str,
        target_role: str,
        target_target: str,
        source: str,
    ) -> None:
        if has_punishment(facts, source_role, source_target):
            store.add("punishment", [target_role, target_target], source)

    def detect_threats(self, facts: list[Fact]) -> list[Finding]:
        findings: list[Finding] = []
        seen: set[str] = set()
        roles = self.by_type("Role")
        victims = self.played_victim_roles(facts)
        assets = self.by_type("Asset")
        global_low_scene = any(node.get("type") == "Scenario" and node.get("complexity") == "Low" for node in self.nodes)
        global_high_scene = any(node.get("type") == "Scenario" and node.get("complexity") == "High" for node in self.nodes)

        def push(
            technique: str,
            victim: dict[str, Any],
            attacker: dict[str, Any],
            asset: dict[str, Any],
            rule_id: str,
            modal_trigger: str = "",
        ) -> None:
            key = technique
            if key in seen:
                return
            seen.add(key)
            findings.append(Finding(
                technique,
                "",
                "",
                rule_id,
                "threat",
                victim.get("name", victim["id"]),
                attacker.get("name", attacker["id"]),
                asset.get("name", asset["id"]),
                technique,
                modal_trigger,
            ))

        for victim in victims:
            for attacker in roles:
                if attacker["id"] == victim["id"]:
                    continue
                awareness = awareness_for_role(victim["id"], facts)
                relation_pressure = (
                    has_fact(facts, "authority", attacker["id"], victim["id"])
                    or has_fact(facts, "subordinate", attacker["id"], victim["id"])
                    or has_fact(facts, "subordinate", victim["id"], attacker["id"])
                )
                trust_pressure = has_fact(facts, "trust", victim["id"], attacker["id"]) or has_fact(facts, "trust", attacker["id"], victim["id"])
                cooperation = (
                    has_any_fact(facts, {"ex_cooperation", "externalCooperation"}, attacker["id"], victim["id"])
                    or has_any_fact(facts, {"ex_cooperation", "externalCooperation"}, victim["id"], attacker["id"])
                )
                scene_levels = self.scene_levels_for(victim["id"], facts)
                has_low_scene = "Low" in scene_levels or (not scene_levels and global_low_scene)
                has_high_scene = "High" in scene_levels or (not scene_levels and global_high_scene)

                for asset in assets:
                    victim_owns_asset = (
                        has_any_fact(facts, {"ownership", "owns", "possesses"}, victim["id"], asset["id"])
                        or has_modal(facts, victim["id"], "possess", asset["id"], OWNERSHIP_MODAL_PREDICATES)
                    )
                    attacker_access = has_modal(facts, attacker["id"], "possess", asset["id"], POSITIVE_ACCESS_MODAL_PREDICATES)
                    victim_access = has_modal(facts, victim["id"], "possess", asset["id"], POSITIVE_ACCESS_MODAL_PREDICATES)
                    negative_boundary = has_modal(facts, attacker["id"], "possess", asset["id"], NEGATIVE_BOUNDARY_MODAL_PREDICATES)
                    recommendation_ambiguity = has_modal(facts, victim["id"], "possess", asset["id"], RECOMMENDATION_MODAL_PREDICATES)
                    victim_access_modal = modal_trigger_for(facts, victim["id"], "possess", asset["id"], POSITIVE_ACCESS_MODAL_PREDICATES)
                    attacker_access_modal = modal_trigger_for(facts, attacker["id"], "possess", asset["id"], POSITIVE_ACCESS_MODAL_PREDICATES)
                    negative_boundary_modal = modal_trigger_for(facts, attacker["id"], "possess", asset["id"], NEGATIVE_BOUNDARY_MODAL_PREDICATES)
                    recommendation_modal = modal_trigger_for(facts, victim["id"], "possess", asset["id"], RECOMMENDATION_MODAL_PREDICATES)
                    if relation_pressure and victim_access:
                        push("Intimidation", victim, attacker, asset, "TR-INT", victim_access_modal)
                    if (trust_pressure or relation_pressure or cooperation) and attacker_access and victim_access:
                        push("Impersonation", victim, attacker, asset, "TR-IMP", join_modal_triggers([attacker_access_modal, victim_access_modal]))
                    if victim_owns_asset and awareness != "High":
                        push("Shoulder Surfing", victim, attacker, asset, "TR-SS", victim_access_modal)
                    if victim_access and (has_low_scene or awareness == "Low"):
                        push("Tailgating", victim, attacker, asset, "TR-TG", victim_access_modal)
                    if victim_owns_asset and awareness in {"Low", "Medium"}:
                        push("Dumpster Diving", victim, attacker, asset, "TR-DD", victim_access_modal)
                    if recommendation_ambiguity and (trust_pressure or cooperation):
                        push("Incentive", victim, attacker, asset, "TR-INC", recommendation_modal)
                    if (relation_pressure or cooperation) and self.has_generated_asset(facts, victim["id"], asset["id"]):
                        push("Responsibility", victim, attacker, asset, "TR-RES", victim_access_modal or task_modal_trigger_for(facts, victim["id"], asset["id"]))
                    if negative_boundary and victim_owns_asset and has_high_scene:
                        push("Distraction", victim, attacker, asset, "TR-DIS", negative_boundary_modal)
        return findings

    def played_victim_roles(self, facts: list[Fact]) -> list[dict[str, Any]]:
        role_ids: list[str] = []
        for fact in facts:
            if fact.predicate != "play" or len(fact.args) < 2:
                continue
            first = self.node_index.get(fact.args[0])
            second = self.node_index.get(fact.args[1])
            role_id = ""
            if first and first.get("type") == "Actor" and second and second.get("type") == "Role":
                role_id = second["id"]
            elif first and first.get("type") == "Role" and second and second.get("type") == "Actor":
                role_id = first["id"]
            if role_id and role_id not in role_ids:
                role_ids.append(role_id)
        return [self.node_index[role_id] for role_id in role_ids if role_id in self.node_index]

    def has_generated_asset(self, facts: list[Fact], role_id: str, asset_id: str) -> bool:
        task_ids = [
            fact.args[2]
            for fact in modal_facts(facts)
            if len(fact.args) == 3 and fact.args[0] == role_id and fact.args[1] == "execute" and modal_predicate_is_positive(fact.predicate)
        ]
        return any(fact.predicate in {"need", "generate", "depend", "needs", "generates", "depends"} and fact.args[0] in task_ids and fact.args[1] == asset_id for fact in facts)

    def scene_levels_for(self, node_id: str, facts: list[Fact]) -> set[str]:
        node = self.node_index.get(node_id)
        if not node:
            return set()
        center = node_center(node)
        return {
            scene["complexity"]
            for scene in self.by_type("Scenario")
            if scene.get("complexity") and point_inside_scenario(center, scene)
        }

    def by_type(self, node_type: str) -> list[dict[str, Any]]:
        return [node for node in self.nodes if node.get("type") == node_type]

    def connected(self, node_id: str, relation_type: str) -> list[dict[str, Any]]:
        result = []
        for edge in self.edges:
            if edge.get("type") != relation_type:
                continue
            if edge.get("from") == node_id and edge.get("to") in self.node_index:
                result.append(self.node_index[edge["to"]])
            elif edge.get("to") == node_id and edge.get("from") in self.node_index:
                result.append(self.node_index[edge["from"]])
        return result

    def modal_relation_fact(self, edge: dict[str, Any]) -> dict[str, Any] | None:
        meta = MODAL_RELATION_META.get(edge.get("type", ""))
        if not meta:
            return None
        first = self.node_index.get(edge.get("from"))
        second = self.node_index.get(edge.get("to"))
        if not first or not second:
            return None
        role = first if first.get("type") == "Role" else second if second.get("type") == "Role" else None
        target = (
            first
            if first.get("type") in {"Task", "Asset"}
            else second
            if second.get("type") in {"Task", "Asset"}
            else None
        )
        if not role or not target:
            return None
        action = "execute" if target.get("type") == "Task" else "possess"
        return {
            "role": role,
            "target": target,
            "action": action,
            "predicate": modal_predicate_from_parts(meta["modal"], meta["polarity"]),
            "punish": meta["punish"],
            "source": f"Relationship:{meta['label']}",
        }

def relation_predicate(relation_type: str) -> str:
    return {
        "plays": "play",
        "owns": "ownership",
        "possesses": "ownership",
        "needs": "need",
        "generates": "generate",
        "depends": "depend",
        "delegates": "delegate",
        "externalCooperation": "ex_cooperation",
    }.get(relation_type, relation_type)


def is_modal_relation_type(relation_type: str) -> bool:
    return relation_type in MODAL_RELATION_META


def modal_predicate(constraint: dict[str, Any]) -> str:
    modal = MODAL_CODE.get(constraint.get("modalType"), "M")
    polarity = str(constraint.get("polarity") or "Positive").lower()
    code = "n" if polarity.startswith("neg") else "p"
    return modal_predicate_from_parts(modal, code)


def is_uncertain_constraint(constraint: dict[str, Any]) -> bool:
    return "uncertain" in str(constraint.get("polarity") or "").lower()


def level_code(value: str) -> str:
    return str(value or "").lower()[:1]


def by_predicate(facts: list[Fact], predicate: str) -> list[Fact]:
    return [fact for fact in facts if fact.predicate == predicate]


def modal_facts(facts: list[Fact]) -> list[Fact]:
    return [fact for fact in facts if fact.predicate.startswith("modal_constraint_")]


def parse_modal_predicate(predicate: str) -> dict[str, Any] | None:
    parts = predicate.split("_")
    if len(parts) < 4 or parts[0] != "modal" or parts[1] != "constraint":
        return None
    modal = parts[2]
    raw_polarity = parts[3]
    if modal not in MODAL_NAME or raw_polarity not in {"p", "n", "u"}:
        return None
    legacy_uncertain = raw_polarity == "u"
    return {
        "modal": modal,
        "polarity": "p" if legacy_uncertain else raw_polarity,
        "legacy_punish": legacy_uncertain or (len(parts) > 4 and parts[4] == "y"),
    }


def modal_predicate_is(predicate: str, modal: str, polarity: str) -> bool:
    parsed = parse_modal_predicate(predicate)
    return bool(parsed and parsed["modal"] == modal and parsed["polarity"] == polarity)


def modal_predicate_is_positive(predicate: str) -> bool:
    parsed = parse_modal_predicate(predicate)
    return bool(parsed and parsed["polarity"] == "p")


def derived_modal_predicate(fact: Fact, modal: str, polarity: str) -> str:
    return modal_predicate_from_parts(modal, polarity)


def has_fact(facts: list[Fact], predicate: str, first: str, second: str) -> bool:
    return any(fact.predicate == predicate and fact.args[:2] == (first, second) for fact in facts)


def has_any_fact(facts: list[Fact], predicates: set[str], first: str, second: str) -> bool:
    return any(has_fact(facts, predicate, first, second) for predicate in predicates)


def has_punishment(facts: list[Fact], role: str, target: str) -> bool:
    return any(fact.predicate == "punishment" and fact.args[:2] == (role, target) for fact in facts)


def modal_trigger_for(facts: list[Fact], role: str, action: str, obj: str, predicates: set[str]) -> str:
    matches: list[Fact] = []
    for fact in facts:
        if fact.predicate not in predicates or not fact.args or fact.args[0] != role:
            continue
        if fact.args == (role, action, obj) or fact.args == (role, obj):
            matches.append(fact)
    match = select_modal_trigger_fact(matches)
    return modal_label_for_trigger(facts, match) if match else ""


def task_modal_trigger_for(facts: list[Fact], role: str, asset: str) -> str:
    task_ids = [
        fact.args[0]
        for fact in facts
        if fact.predicate in {"need", "generate", "depend", "needs", "generates", "depends"}
        and len(fact.args) >= 2
        and fact.args[1] == asset
    ]
    matches = [
        fact
        for fact in modal_facts(facts)
        if len(fact.args) == 3 and fact.args[0] == role and fact.args[1] == "execute" and fact.args[2] in task_ids
    ]
    match = select_modal_trigger_fact(matches)
    return modal_label_for_trigger(facts, match) if match else ""


def select_modal_trigger_fact(matches: list[Fact]) -> Fact | None:
    if not matches:
        return None
    relationship = next((fact for fact in matches if fact.source.startswith("Relationship:")), None)
    if relationship:
        return relationship
    rank = {"M": 0, "Sh": 1, "S": 2, "C": 3}
    return sorted(matches, key=lambda fact: rank.get((parse_modal_predicate(fact.predicate) or {}).get("modal", ""), 9))[0]


def modal_label_from_fact(fact: Fact) -> str:
    if fact.source.startswith("Relationship:"):
        return modal_label_from_code(fact.source.replace("Relationship:", "", 1))
    return modal_label_from_predicate(fact.predicate)


def modal_label_for_trigger(facts: list[Fact], fact: Fact) -> str:
    parsed = parse_modal_predicate(fact.predicate)
    if not parsed:
        return ""
    return modal_display_label(parsed)


def modal_label_from_code(label: str) -> str:
    parts = [part.strip() for part in label.split(",") if part.strip()]
    if len(parts) < 2:
        return label
    return modal_display_label({"modal": parts[0]})


def modal_label_from_predicate(predicate: str) -> str:
    parsed = parse_modal_predicate(predicate)
    return modal_display_label(parsed) if parsed else ""


def modal_display_label(parsed: dict[str, Any]) -> str:
    return MODAL_NAME.get(parsed["modal"], parsed["modal"])


def join_modal_triggers(values: list[str]) -> str:
    result: list[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return " / ".join(result)


def has_modal(facts: list[Fact], role: str, action: str, obj: str, predicates: set[str]) -> bool:
    return any(
        fact.predicate in predicates
        and fact.args[0] == role
        and (
            fact.args == (role, action, obj)
            or fact.args == (role, obj)
        )
        for fact in facts
    )


def awareness_for_role(role_id: str, facts: list[Fact]) -> str:
    levels = {"h": "High", "m": "Medium", "l": "Low"}
    for fact in facts:
        if fact.predicate == "has_security_awareness" and fact.args[0] == role_id:
            return levels.get(fact.args[1], "Medium")
    return "Medium"


def node_size(node: dict[str, Any]) -> tuple[float, float]:
    defaults = {
        "Role": (94.0, 94.0),
        "Actor": (94.0, 94.0),
        "Task": (160.0, 62.0),
        "Asset": (160.0, 62.0),
        "Scenario": (286.0, 118.0),
        "Constraint": (118.0, 44.0),
    }
    fallback = defaults.get(node.get("type"), (132.0, 72.0))
    return float(node.get("width") or fallback[0]), float(node.get("height") or fallback[1])


def node_center(node: dict[str, Any]) -> tuple[float, float]:
    width, height = node_size(node)
    return float(node.get("x", 0)) + width / 2, float(node.get("y", 0)) + height / 2


def point_inside_scenario(point: tuple[float, float], scenario: dict[str, Any]) -> bool:
    width, height = node_size(scenario)
    cx, cy = node_center(scenario)
    rx = width / 2
    ry = height / 2
    if rx <= 0 or ry <= 0:
        return False
    px, py = point
    return ((px - cx) ** 2) / (rx ** 2) + ((py - cy) ** 2) / (ry ** 2) <= 1
