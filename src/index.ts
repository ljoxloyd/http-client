import * as io from "io-ts"

interface EndpointInit<
	Url extends string,
	Method extends HttpRestMethod,
	Input extends any[],
	Output
> {
	readonly url: Url
	readonly method: Method
	readonly options?: OtherOptions
	readonly headersGetter: Lazy<HeadersInit>
	readonly requestBodySelector: InputSelector<Input>
	readonly responseBodySelector: OutputSelector<Output>
}

export default class Endpoint<
	Url extends string,
	Method extends HttpRestMethod,
	Input extends any[],
	Output
> {
	private constructor(private readonly init: EndpointInit<Url, Method, Input, Output>) {}

	/**
	 * Convenience method to ensure endpoint build starts with url
	 */
	static url<Url extends string>(url: Url) {
		return new Builder({
			url,
			method: "GET",
			headersGetter: () => ({}),
			requestBodySelector: () => null,
			responseBodySelector: (r) => r.json(),
		})
	}

	/**
	 * TODO: change this signature to better handle cases when url has no parameters
	 * and params-object is empty.
	 */
	toRequest(params: UrlParametersObject<Url>, ...data: Input) {
		const url = this.toURL(params)
		const init = this.toRequestInit(...data)
		return new Request(url, init)
	}

	toRequestInit(...data: Input) {
		let body: BodyInit | null
		const input = this.init.requestBodySelector(...data)
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
            method = this.init.method,
            options = this.init.options

		return { ...options, body, method, headers }
	}

	toURL(params: UrlParametersObject<Url>) {
		let url: string = this.init.url
		for (const name of getUrlParametersNames(this.init.url)) {
			url = url.replace(`/{${name}}`, "/" + params[name])
		}
		return new URL(url)
	}

	toBuilder() {
		return new Builder(this.init)
	}

	getResult(response: Response) {
		return this.init.responseBodySelector(response)
	}
}

class Builder<Url extends string, Method extends HttpRestMethod, Input extends any[], Output> {
	constructor(private readonly init: EndpointInit<Url, Method, Input, Output>) {}

	url<NewUrl extends string>(url: NewUrl) {
		return new Builder({ ...this.init, url })
	}

	method<NewMethod extends HttpRestMethod>(method: NewMethod) {
		return new Builder({ ...this.init, method })
	}

	expects<NewInput extends any[]>(requestBodySelector: InputSelector<NewInput>) {
		return new Builder({ ...this.init, requestBodySelector })
	}

	returns<NewOutput>(responseBodySelector: OutputSelector<NewOutput>) {
		return new Builder({ ...this.init, responseBodySelector })
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

	build(): Endpoint<Url, Method, Input, Output> {
		// @ts-expect-error because Endpoint constructor is private but builder must be able to construct it
		return new Endpoint(this.init)
	}
}

//
// ==== ==== ==== Utils ==== ==== ====

type OtherOptions = Omit<RequestInit, "body" | "method" | "headers">

type Lazy<T> = () => T

type OutputSelector<T> = (response: Response) => Promise<T>
type InputSelector<T extends any[]> = (...params: T) => object | string | null

function getUrlParametersNames<Url extends string>(url: Url) {
	return (url.match(/(?<=\/\{)(\w+)(?=\})/g) ?? []) as Array<UrlParametersNames<Url>>
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

export type UrlWithParameters<
	Base extends string = string,
	Arg extends string = string,
	Rest extends string = string
> = `${Base}/{${Arg}}${Rest}`

export type UrlParametersObject<Url extends string> = Record<UrlParametersNames<Url>, string>

export type UrlParametersNames<Url extends string> = Url extends UrlWithParameters<
	string,
	infer Arg,
	infer RestOfUrl
>
	? Url extends UrlWithParameters
		? Arg | UrlParametersNames<RestOfUrl>
		: Arg
	: never

export type UrlOf<E> = InferredInfo<E>["_url"]

export type MethodOf<E> = InferredInfo<E>["_method"]

export type InputFor<E> = InferredInfo<E>["_input"]

export type OutputOf<E> = InferredInfo<E>["_output"]

type InferredInfo<E> = E extends
	| EndpointInit<infer Url, infer Method, infer Input, infer Output>
	| Endpoint<infer Url, infer Method, infer Input, infer Output>
	| Builder<infer Url, infer Method, infer Input, infer Output>
	? { _url: Url; _method: Method; _input: Input; _output: Output }
	: never

//
// ==== ==== ==== Tests ==== ==== ====
namespace test {
	type url = UrlOf<typeof MyApiEndpoint>
	//    ^?
	type method = MethodOf<typeof MyApiEndpoint>
	//    ^?
	type input = InputFor<typeof MyApiEndpoint>
	//    ^?
	type output = OutputOf<typeof MyApiEndpoint>
	//    ^?

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
		.returns((r) => r.json().then(ResponseData.decode))
		.build()

	const AnotherEndpoint = MyApiEndpoint.toBuilder()
		//     ^?
		.method("DELETE")
		.returns((r) => r.json().then(io.type({ whatever: io.number }).decode))
		.expects(() => null)
		.build()

	// @ts-expect-error no id
	AnotherEndpoint.toUrl({})
	// @ts-expect-error incorrect parameters
	AnotherEndpoint.toUrl({ anything: 42 })
	// correct
	AnotherEndpoint.toURL({ id: "42" })

	// @ts-expect-error login and password not passed
	MyApiEndpoint.toRequestInit()
	// correct
	MyApiEndpoint.toRequestInit("+7909@gmail.com", "qwerty")
}
