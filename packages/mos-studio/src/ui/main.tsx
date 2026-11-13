import { useCallback, useEffect, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { connectStudioHost, type StudioHost } from "./host.js";
import {
  initialPanelState,
  panelReducer,
  TOOL_NAMES,
  unwrapError,
  unwrapItems,
  type MissionRow,
  type CapabilityRow,
  type RoutesView,
  type ReadOutcomeView,
  type StatusView,
} from "./model.js";

/**
 * MOS studio 面板：New Task → Mission 关联状态、操作者声明、连接账户能力解析、
 * 路由候选与一次授权读。全部经本插件 server 工具；密钥输入提交后立即从状态清除。
 */

function App({ host }: { host: StudioHost }) {
  const [state, dispatch] = useReducer(panelReducer, initialPanelState);
  const [ready, setReady] = useState(false);

  const refreshStatus = useCallback(async () => {
    const status = await host.call<StatusView>(TOOL_NAMES.status);
    if (!status) return;
    const error = unwrapError(status);
    if (error) {
      dispatch({ type: "error", message: error });
      return;
    }
    dispatch({ type: "status", status });
  }, [host]);

  useEffect(() => {
    void (async () => {
      await refreshStatus();
      const missions = await host.call<unknown>(TOOL_NAMES.listMissions);
      dispatch({
        type: "missions",
        missions: unwrapItems<MissionRow>(missions ?? null),
      });
      const capabilities = await host.call<unknown>(TOOL_NAMES.capabilities);
      dispatch({
        type: "capabilities",
        capabilities: unwrapItems<CapabilityRow>(capabilities ?? null),
      });
      setReady(true);
    })();
  }, [host, refreshStatus]);

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      dispatch({ type: "busy", label });
      try {
        await action();
      } finally {
        dispatch({ type: "busy", label: null });
      }
    },
    [],
  );

  const submitOperator = () =>
    run("operator", async () => {
      const result = await host.call(TOOL_NAMES.setOperator, {
        user_id: state.operatorInput.trim(),
      });
      const error = unwrapError(result ?? null);
      if (error) return dispatch({ type: "error", message: error });
      dispatch({ type: "error", message: null });
      dispatch({ type: "field", name: "operatorInput", value: "" });
      await refreshStatus();
    });

  const submitIntake = () =>
    run("intake", async () => {
      const result = await host.call(TOOL_NAMES.recordIntake, {
        objective_verbatim: state.intakeInput,
      });
      const error = unwrapError(result ?? null);
      if (error) return dispatch({ type: "error", message: error });
      dispatch({ type: "error", message: null });
      dispatch({ type: "field", name: "intakeInput", value: "" });
      const missions = await host.call<unknown>(TOOL_NAMES.listMissions);
      dispatch({ type: "missions", missions: unwrapItems<MissionRow>(missions ?? null) });
      await refreshStatus();
    });

  const submitConnect = () =>
    run("connect", async () => {
      const result = await host.call(TOOL_NAMES.connectComposio, {
        api_key: state.apiKeyInput.trim(),
      });
      dispatch({ type: "clearSecrets" });
      const error = unwrapError(result ?? null);
      if (error) return dispatch({ type: "error", message: error });
      dispatch({ type: "error", message: null });
      const capabilities = await host.call<unknown>(TOOL_NAMES.capabilities);
      dispatch({
        type: "capabilities",
        capabilities: unwrapItems<CapabilityRow>(capabilities ?? null),
      });
      await refreshStatus();
    });

  const evaluateRoutes = () =>
    run("routes", async () => {
      const result = await host.call<RoutesView>(TOOL_NAMES.routes);
      const error = unwrapError(result ?? null);
      if (error) return dispatch({ type: "error", message: error });
      if (result) dispatch({ type: "routes", routes: result });
    });

  const executeRead = () =>
    run("read", async () => {
      const result = await host.call<ReadOutcomeView>(TOOL_NAMES.executeRead, {
        query: state.readQuery.trim(),
      });
      const error = unwrapError(result ?? null);
      if (error) return dispatch({ type: "error", message: error });
      if (result) dispatch({ type: "read", outcome: result });
    });

  if (!ready) {
    return <div className="loading">MOS studio loading…</div>;
  }

  return (
    <main>
      <header>
        <span
          className="chip"
          data-available={state.status?.availability.available ?? false}
        >
          {state.status?.availability.available ? "MOS: on" : "MOS: idle"}
        </span>
        <span className="meta">
          {state.status?.session ? `session ${shortId(state.status.session)}` : "no session context"}
        </span>
      </header>

      {state.error ? <p className="error">{state.error}</p> : null}

      <section>
        <h2>Operator</h2>
        {state.status?.operator_configured ? (
          <p className="ok">operator declared</p>
        ) : (
          <div className="row">
            <input
              value={state.operatorInput}
              placeholder="operator user id (e.g. email)"
              onChange={(event) =>
                dispatch({ type: "field", name: "operatorInput", value: event.target.value })
              }
            />
            <button disabled={!state.operatorInput.trim() || !!state.busy} onClick={submitOperator}>
              Declare
            </button>
          </div>
        )}
      </section>

      <section>
        <h2>Mission (linked to this session)</h2>
        {state.status?.mission ? (
          <MissionCard mission={state.status.mission} />
        ) : (
          <p className="muted">
            no mission linked yet — create a New Task (sidecar records it) or record intake below
          </p>
        )}
        <div className="row">
          <textarea
            value={state.intakeInput}
            placeholder="mission objective (verbatim, exactly as you mean it)"
            onChange={(event) =>
              dispatch({ type: "field", name: "intakeInput", value: event.target.value })
            }
          />
        </div>
        <button disabled={!state.intakeInput.trim() || !!state.busy} onClick={submitIntake}>
          Record intake (verbatim)
        </button>
        {state.missions.length > 0 ? (
          <ul className="list">
            {state.missions.map((mission) => (
              <MissionCard key={mission.id} mission={mission} />
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h2>Connected accounts & capabilities</h2>
        {state.capabilities.length === 0 ? (
          <div>
            <p className="muted">no composio connection yet</p>
            <div className="row">
              <input
                type="password"
                value={state.apiKeyInput}
                placeholder="composio api key (stored encrypted; never echoed)"
                onChange={(event) =>
                  dispatch({ type: "field", name: "apiKeyInput", value: event.target.value })
                }
              />
              <button disabled={!state.apiKeyInput.trim() || !!state.busy} onClick={submitConnect}>
                Connect
              </button>
            </div>
          </div>
        ) : (
          <ul className="list">
            {state.capabilities.map((capability) => (
              <li key={capability.capability_id} data-status={capability.status}>
                <strong>{capability.capability_id}</strong>
                <span className={`pill ${capability.status}`}>{capability.status}</span>
                <span className="muted">
                  tool mapping {capability.tool_mapping_verified ? "verified" : "unverified"}
                </span>
                {capability.missing_preconditions.length > 0 ? (
                  <ul className="pre">
                    {capability.missing_preconditions.map((precondition) => (
                      <li key={precondition}>{precondition}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Routes</h2>
        <button disabled={!!state.busy} onClick={evaluateRoutes}>
          Evaluate route candidates
        </button>
        {state.routes ? (
          <div>
            <p className="meta">
              {state.routes.summary.existing} existing · {state.routes.summary.conditional} conditional
              · {state.routes.summary.blocked} blocked · {state.routes.summary.unknown} unknown
            </p>
            <ul className="list">
              {state.routes.routes.map((route) => (
                <li key={route.route_id}>
                  <span className={`pill ${route.route_class}`}>{route.route_class}</span>
                  <span className="muted">{shortId(route.route_id)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">not evaluated yet</p>
        )}
      </section>

      <section>
        <h2>Authorized read (Composio → Hacker News)</h2>
        <div className="row">
          <input
            value={state.readQuery}
            placeholder="search query"
            onChange={(event) =>
              dispatch({ type: "field", name: "readQuery", value: event.target.value })
            }
          />
          <button disabled={!state.readQuery.trim() || !!state.busy} onClick={executeRead}>
            Execute read
          </button>
        </div>
        {state.readOutcome ? <ReadOutcome outcome={state.readOutcome} /> : null}
      </section>

      {state.busy ? <footer className="busy">{state.busy}…</footer> : null}
    </main>
  );
}

function MissionCard({ mission }: { mission: MissionRow }) {
  return (
    <li className="mission">
      <strong>{shortId(mission.id)}</strong>
      <span className={`pill ${mission.status}`}>{mission.status}</span>
      <p>{mission.objective}</p>
      {mission.source_zcode_session_id ? (
        <span className="meta">linked to session {shortId(mission.source_zcode_session_id)}</span>
      ) : (
        <span className="muted">no session link</span>
      )}
    </li>
  );
}

function ReadOutcome({ outcome }: { outcome: ReadOutcomeView }) {
  if (outcome.status === "succeeded") {
    return (
      <div className="ok">
        <p>
          read succeeded via {outcome.evidence.observed_via} ({outcome.evidence.tool})
        </p>
        <pre>{JSON.stringify(outcome.evidence.facts, null, 2)}</pre>
        <span className="meta">observed at {outcome.evidence.observed_at}</span>
      </div>
    );
  }
  if (outcome.status === "blocked") {
    return (
      <div className="warn">
        <p>read blocked: {outcome.reason}</p>
        {outcome.missing_preconditions.length > 0 ? (
          <ul className="pre">
            {outcome.missing_preconditions.map((precondition) => (
              <li key={precondition}>{precondition}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <div className="warn">
      <p>
        read failed at {outcome.stage}: {outcome.classified} → {outcome.action}
      </p>
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 24 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id;
}

const container = document.getElementById("root");
if (container) {
  void connectStudioHost().then((host) => {
    createRoot(container).render(<App host={host} />);
  });
}
