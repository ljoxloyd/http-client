import * as io from "io-ts"

interface EndpointInit<
	Path extends string,
	Method extends HttpRestMethod,
	Input extends any[],
	Output
> {
	readonly url: Path
	readonly method: Method
	readonly options?: OtherOptions
	readonly headersGetter: Lazy<HeadersInit>
	readonly inputSelector: Selector<Input>
	readonly outputDecoder: io.Decoder<any, Output>
}

export default class Endpoint<
	Path extends string,
	Method extends HttpRestMethod,
	Input extends any[],
	Output
> {
	private constructor(private readonly init: EndpointInit<Path, Method, Input, Output>) {}

	/**
	 * Convenience method to ensure endpoint build starts with url
	 */
	static url<Path extends string>(url: Path) {
		return new Builder({
			url,
			method: "GET",
			headersGetter: () => ({}),
			inputSelector: () => null,
			outputDecoder: io.unknown,
		})
	}

	/**
	 * TODO: change this signature to better handle cases when url has no parameters
	 * and params-object is empty.
	 */
	toRequest(params: PathParametersObject<Path>, ...data: Input) {
		const url = this.toUrl(params)
		const init = this.toRequestInit(...data)
		return new Request(url, init)
	}

	toRequestInit(...data: Input) {
		let body: BodyInit | null
		const input = this.init.inputSelector(...data)
		if (
			input === null ||
			typeof input === "string" ||
			input instanceof Blob ||
			input instanceof FormData ||
			input instanceof ReadableStream ||
			input instanceof URLSearchParams ||
			input instanceof ArrayBuffer ||
			isArrayBufferView(input)
		) {
			body = input
		} else {
			body = JSON.stringify(input)
		}
		// prettier-ignore
		let headers = this.init.headersGetter(),
            method  = this.init.method,
            options = this.init.options

		return { ...options, body, method, headers }
	}

	/**
	 * Could I make it return literal-type with interpolated values 🤔
	 * ```
	 * endpoint<'/{a}/{b}'>.toUrl({a: 4, b: 20}) // '/4/20'
	 * ```
	 */
	toUrl(params: PathParametersObject<Path>) {
		let url: string = this.init.url
		for (const name of getPathParametersNames(this.init.url)) {
			url = url.replace(`/{${name}}`, "/" + params[name])
		}
		return url
	}

	toValidation(something: unknown) {
		return this.init.outputDecoder.decode(something)
	}

	toBuilder() {
		return new Builder(this.init)
	}
}

class Builder<Path extends string, Method extends HttpRestMethod, Input extends any[], Output> {
	constructor(private readonly init: EndpointInit<Path, Method, Input, Output>) {}

	url<NewPath extends string>(url: NewPath) {
		return new Builder({ ...this.init, url })
	}

	method<NewMethod extends HttpRestMethod>(method: NewMethod) {
		return new Builder({ ...this.init, method })
	}

	expects<NewInput extends any[]>(inputSelector: Selector<NewInput>) {
		return new Builder({ ...this.init, inputSelector })
	}

	returns<NewOutput>(outputDecoder: io.Decoder<any, NewOutput>) {
		return new Builder({ ...this.init, outputDecoder })
	}

	headers(headers: HeadersInit | { new (): Headers }) {
		return new Builder({
			...this.init,
			headersGetter: typeof headers !== "function" ? () => headers : () => new headers(),
		})
	}

	options(options: OtherOptions) {
		return new Builder({ ...this.init, options })
	}

	build(): Endpoint<Path, Method, Input, Output> {
		// @ts-expect-error because Endpoint constructor is private but builder must be able to construct it
		return new Endpoint(this.init)
	}
}

//
// ==== ==== ==== Utils ==== ==== ====

type OtherOptions = Omit<RequestInit, "body" | "method" | "headers">

type Lazy<T> = () => T

type Selector<T extends any[]> = (...params: T) => object | string | null

function getPathParametersNames<Path extends string>(url: Path) {
	return (url.match(/(?<=\/\{)(\w+)(?=\})/g) ?? []) as Array<PathParametersNames<Path>>
}

function isArrayBufferView(body: object): body is ArrayBufferView {
	return "buffer" in body && body.buffer instanceof ArrayBuffer
}

//
// ==== ==== ==== Enums ==== ==== ====

export type HttpRestQueryMethod = typeof HttpRestQueryMethod[keyof typeof HttpRestQueryMethod]
export const HttpRestQueryMethod = {
	Get: "GET",
	Head: "HEAD",
	Options: "OPTIONS",
} as const

export type HttpRestMutationMethod =
	typeof HttpRestMutationMethod[keyof typeof HttpRestMutationMethod]
export const HttpRestMutationMethod = {
	Post: "POST",
	Put: "PUT",
	Patch: "PATCH",
	Delete: "DELETE",
} as const

export type HttpRestMethod = typeof HttpRestMethod[keyof typeof HttpRestMethod]
export const HttpRestMethod = {
	...HttpRestQueryMethod,
	...HttpRestMutationMethod,
} as const

//
// ==== ==== ==== Types ==== ==== ====

type PathParametersObject<Path extends string> = Record<PathParametersNames<Path>, string>

type PathHasParams<Path extends string> = Path extends `${string}/{${string}}${string}`
	? true
	: false

type PathParametersNames<Path extends string> =
	Path extends `${string}/{${infer Arg}}${infer RestOfPath}`
		? PathHasParams<RestOfPath> extends true
			? Arg | PathParametersNames<RestOfPath>
			: Arg
		: never

export type ParamsFor<E extends AnyEndpoint> = E extends Endpoint<infer U, any, any, any>
	? PathParametersObject<U>
	: never

export type InputFor<E extends AnyEndpoint> = E extends Endpoint<any, any, infer I, any> ? I : never

export type OutputOf<E extends AnyEndpoint> = E extends Endpoint<any, any, any, infer O> ? O : never

type AnyEndpoint = Endpoint<any, any, any, any>

//
// ==== ==== ==== Tests ==== ==== ====

const BaseEndpoint = Endpoint.url("/")
	.headers({
		"Content-Type": "application/json",
		"X-Requested-With": "XMLHttpRequest",
	})
	.options({
		cache: "force-cache",
	})

type RequestData = { login: string; password: string }
type ResponseData = io.TypeOf<typeof ResponseData>
const ResponseData = io.type({ success: io.boolean })

const MyApiEndpoint = BaseEndpoint.url("api/v1/thing/{id}")
	//     ^?
	.method("POST")
	.expects((login: string, password: string): RequestData => ({ login, password }))
	.returns(ResponseData)
	.build()

const AnotherEndpoint = MyApiEndpoint.toBuilder()
	//     ^?
	.method("DELETE")
	.returns(io.type({ whatever: io.number }))
	.expects(() => null)
	.build()

// @ts-expect-error no id
AnotherEndpoint.toUrl({})
// @ts-expect-error incorrect parameters
AnotherEndpoint.toUrl({ anything: 42 })
// correct
AnotherEndpoint.toUrl({ id: "42" })

// @ts-expect-error login and password not passed
MyApiEndpoint.toRequestInit()
// correct
MyApiEndpoint.toRequestInit("+7909@gmail.com", "qwerty")
