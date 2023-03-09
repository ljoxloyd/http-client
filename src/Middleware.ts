import Endpoint, { UrlOf, InputFor, OutputOf, UrlParametersObject } from "./index"

/**
 * Hooks are essentially a middleware, with only differences is that a hook
 * can't stop request flow and is not required to return anything
 */
type Hooks = {
	/**
	 * Runs before request is fetched
	 *
	 * @param request - `Request` instance passed to `send` method
	 * @returns `Request` - will be passed to next hook in sequence
	 * @returns `void` - same as returning `request` parameter unaffected
	 */
	onCreated: (request: Request) => Request | void

	/**
	 *  Runs after request, if it was successful
	 *
	 * @param response - has no access to body to prevent consuming it early
	 * @returns nothing to leave response untouched or new Response instance to substitute request result
	 */
	onSuccess: (response: Omit<Response, keyof Body>) => Response | void

	/**
	 * Runs after request, if error was thrown
	 *
	 * @param failure anything that was thrown in previous hooks, during fetch or while consuming body
	 * @returns any other error you deem to fit, **avoid throwing inside this hook**
	 */
	onFailure: (failure: unknown) => unknown | void
	/**
	 * Runs unconditionally after request
	 *
	 * @returns nothing
	 */
	onSettled: () => void
}

export class Middleware {
	private constructor(private readonly hooks: HookSequences) {}

	static create(hooks: Partial<Hooks> = {}) {
		return new Middleware(HookSequences.from(hooks))
	}

	static extend(client: Middleware, hooks: Partial<Hooks> = {}) {
		return new Middleware(HookSequences.concat(client.hooks, HookSequences.from(hooks)))
	}

	public async call<E extends Endpoint<any, any, any, any>>(
		endpoint: E,
		params: UrlParametersObject<UrlOf<E>>,
		body: InputFor<E>
		// @ts-expect-error TODO
	): Promise<OutputOf<E>> {
		const request = endpoint.toRequest(params, body)
		const response = await this.send(request)
		const result = endpoint.getResult(await response.json())
	}

	public async send(request: Request): Promise<Response> {
		const { onCreated, onSuccess, onFailure, onSettled } = this.hooks
		try {
			for (const hook of onCreated) {
				request = hook(request) ?? request
			}
			let response = await fetch(request)
			for (const hook of onSuccess) {
				response = hook(response) ?? response
			}
			return response
		} catch (failure) {
			for (const hook of onFailure) {
				failure = hook(failure) ?? failure
			}
			throw failure
		} finally {
			for (const hook of onSettled) {
				hook()
			}
		}
	}
}

type HookSequences = {
	[Key in keyof Hooks]: Array<Hooks[Key]>
}

namespace HookSequences {
	export function from(hooks: Partial<Hooks>): HookSequences {
		return {
			onCreated: hooks.onCreated ? [hooks.onCreated] : [],
			onSuccess: hooks.onSuccess ? [hooks.onSuccess] : [],
			onFailure: hooks.onFailure ? [hooks.onFailure] : [],
			onSettled: hooks.onSettled ? [hooks.onSettled] : [],
		}
	}

	export function concat(target: HookSequences, source: HookSequences) {
		return {
			onCreated: target.onCreated.concat(source.onCreated),
			onSuccess: target.onSuccess.concat(source.onSuccess),
			onFailure: target.onFailure.concat(source.onFailure),
			onSettled: target.onSettled.concat(source.onSettled),
		}
	}
}
