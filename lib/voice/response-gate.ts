/**
 * One Realtime response at a time. response.create while another response is
 * active is rejected ("Conversation already has an active response").
 */
export interface ResponseGate {
  active: boolean
  /** Ask for one follow-up response once nothing else is in flight. */
  followUp: boolean
  tools: number
  /** Slow lookups still running. response.create waits until this is 0. */
  asyncOpen: number
}

export function idleResponseGate(): ResponseGate {
  return { active: false, followUp: false, tools: 0, asyncOpen: 0 }
}

export interface GateStep {
  gate: ResponseGate
  /** Send response.create now. */
  create: boolean
}

function continueIfIdle(gate: ResponseGate): GateStep {
  if (gate.followUp && !gate.active && gate.tools === 0 && gate.asyncOpen === 0) {
    return { gate: { active: true, followUp: false, tools: 0, asyncOpen: 0 }, create: true }
  }
  return { gate, create: false }
}

export function gateResponseStarted(gate: ResponseGate): ResponseGate {
  return { ...gate, active: true }
}

export function gateToolStarted(gate: ResponseGate): ResponseGate {
  return { ...gate, tools: gate.tools + 1 }
}

/** A slow lookup started. The Realtime turn is not closed with response.create. */
export function gateAsyncStarted(gate: ResponseGate): ResponseGate {
  return { ...gate, tools: gate.tools + 1, asyncOpen: gate.asyncOpen + 1 }
}

/** The model finished a response. A queued follow-up may start now. */
export function gateResponseFinished(gate: ResponseGate): GateStep {
  return continueIfIdle({ ...gate, active: false })
}

/**
 * response.create was rejected because a response is already running.
 * Keep the follow-up and wait for that response to finish.
 */
export function gateResponseBusy(gate: ResponseGate): ResponseGate {
  return { ...gate, active: true, followUp: true }
}

/** Greeting or any other explicit response.create. */
export function gateRequestResponse(gate: ResponseGate): GateStep {
  return continueIfIdle({ ...gate, followUp: true })
}

/**
 * Tool result is in. `followUp` false ends the turn without another response
 * (the caller is hanging up) and drops any queued follow-up.
 */
export function gateToolFinished(gate: ResponseGate, followUp: boolean): GateStep {
  return continueIfIdle({
    active: gate.active,
    tools: Math.max(0, gate.tools - 1),
    asyncOpen: gate.asyncOpen,
    followUp: followUp ? gate.followUp || followUp : false,
  })
}

/**
 * The slow lookup finished and its function_call_output was delivered.
 * A follow-up response is allowed only when no async call is still open.
 */
export function gateAsyncFinished(gate: ResponseGate, followUp: boolean): GateStep {
  return continueIfIdle({
    active: gate.active,
    tools: Math.max(0, gate.tools - 1),
    asyncOpen: Math.max(0, gate.asyncOpen - 1),
    followUp: followUp ? gate.followUp || followUp : false,
  })
}
