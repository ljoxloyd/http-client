import * as io from "io-ts"

// needs a better name but not things-`Endpoint`-uses-to-store-types-and-transform-into-`Request`
interface EndpointInfo<
	Url extends string,
	Method extends HttpRestMethod,
	Input extends any[],
	Output
> {
	readonly url: Url
	readonly method: Method
	readonly headersGetter: HeadersGetter
	readonly inputSelector: InputSelector<Input>
	readonly outputDecoder: io.Decoder<any, Output>

	readonly options?: EndpointRequestInit
	readonly baseUrl: string | URL
}

type PathString = `/${string}`
type HeadersGetter = () => HeadersInit
type InputSelector<T extends any[]> = (...params: T) => object | string | null

interface EndpointRequestInit extends Omit<RequestInit, "body" | "method" | "headers"> {
	//
}

export default class Endpoint<
	Url extends string,
	Method extends HttpRestMethod,
	Input extends any[],
	Output
> {
	private constructor(private readonly info: EndpointInfo<Url, Method, Input, Output>) {}

	static base(baseUrl: string | URL, baseInitOptions?: EndpointRequestInit) {
		return new Builder({
			url: "/",
			baseUrl,
			method: "GET",
			headersGetter: () => ({}),
			inputSelector: () => null,
			outputDecoder: io.unknown,
			options: baseInitOptions,
		})
	}

	/**
	 * TODO: change this signature to better handle cases when url has no parameters
	 * and params-object is empty.
	 */
	toRequest(params: UrlParametersObject<Url>, ...data: Input): Request {
		const url = this.toURL(params)
		const init = this.toRequestInit(...data)
		return new Request(url, init)
	}

	toRequestInit(...data: Input): RequestInit {
		let body: BodyInit | null
		const input = this.info.inputSelector(...data)
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
		let headers = this.info.headersGetter(),
            method = this.info.method,
            options = this.info.options

		return { ...options, body, method, headers }
	}

	toURL(params: UrlParametersObject<Url>): URL {
		let url: string = this.info.url
		for (const name of getUrlParametersNames(this.info.url)) {
			url = url.replace(`/{${name}}`, "/" + params[name])
		}

		return new URL(url, this.info.baseUrl)
	}

	toValidation(something: unknown) {
		return this.info.outputDecoder.decode(something)
	}

	toBuilder() {
		return new Builder(this.info)
	}
}

class Builder<Url extends string, Method extends HttpRestMethod, Input extends any[], Output> {
	constructor(private readonly info: EndpointInfo<Url, Method, Input, Output>) {}

	build(): Endpoint<Url, Method, Input, Output> {
		// @ts-expect-error because Endpoint constructor is private but builder must be able to construct it
		return new Endpoint(this.info)
	}

	url<NewPath extends PathString>(url: NewPath) {
		return new Builder({ ...this.info, url })
	}

	method<NewMethod extends HttpRestMethod>(method: NewMethod) {
		return new Builder({ ...this.info, method })
	}

	expects<NewInput extends any[]>(inputSelector: InputSelector<NewInput>) {
		return new Builder({ ...this.info, inputSelector })
	}

	returns<NewOutput>(outputDecoder: io.Decoder<any, NewOutput>) {
		return new Builder({ ...this.info, outputDecoder })
	}

	headers(headers: HeadersInit | { new (): Headers }) {
		if (typeof headers === "function") {
			return new Builder({ ...this.info, headersGetter: () => new headers() })
		}
		const headersGetter = () => ({
			...this.info.headersGetter(),
			...headers,
		})
		return new Builder({ ...this.info, headersGetter })
	}

	options(options: EndpointRequestInit) {
		return new Builder({
			...this.info,
			options: { ...this.info.options, ...options },
		})
	}
}

//
// ==== ==== ==== Utils ==== ==== ====

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

export type UrlWithParameter<
	Arg extends string = string,
	Rest extends string = string
> = `${string}/{${Arg}}${Rest}`

export type UrlParametersObject<Url extends string> = Record<UrlParametersNames<Url>, string>

export type UrlParametersNames<Url extends string> = Url extends UrlWithParameter<
	infer Arg,
	infer RestOfUrl
>
	? Url extends UrlWithParameter
		? Arg | UrlParametersNames<RestOfUrl>
		: Arg
	: never

export type UrlOf<E> = InferredInfo<E>["_url"]

export type MethodOf<E> = InferredInfo<E>["_method"]

export type InputFor<E> = InferredInfo<E>["_input"]

export type OutputOf<E> = InferredInfo<E>["_output"]

type InferredInfo<E> = E extends
	| EndpointInfo<infer Url, infer Method, infer Input, infer Output>
	| Endpoint<infer Url, infer Method, infer Input, infer Output>
	| Builder<infer Url, infer Method, infer Input, infer Output>
	? { _url: Url; _method: Method; _input: Input; _output: Output }
	: never

//
// ==== ==== ==== Tests ==== ==== ====

type url = UrlOf<typeof MyApiEndpoint>
//    ^?
type method = MethodOf<typeof MyApiEndpoint>
//    ^?
type input = InputFor<typeof MyApiEndpoint>
//    ^?
type output = OutputOf<typeof MyApiEndpoint>
//    ^?

const BaseEndpoint = Endpoint.base("https://api.raison-qa.dev/", {
	cache: "force-cache",
}).headers({
	"Content-Type": "application/json",
	"X-Requested-With": "XMLHttpRequest",
})

type RequestData = { login: string; password: string }
type ResponseData = io.TypeOf<typeof ResponseData>
const ResponseData = io.type({ success: io.boolean })

const MyApiEndpoint = BaseEndpoint.url("/api/v1/thing/{id}")
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

AnotherEndpoint.toURL(
	// @ts-expect-error no id
	{}
)
AnotherEndpoint.toURL({
	// @ts-expect-error incorrect parameters
	anything: 42,
})
// correct
AnotherEndpoint.toURL({ id: "42" })

function fails_on_node_because_no_Blob() {
	// @ts-expect-error login and password not passed
	MyApiEndpoint.toRequestInit()
	MyApiEndpoint.toRequestInit(
		"+7909@gmail.com",
		// @ts-expect-error incorrect password type passed
		123456
	)
	// correct
	MyApiEndpoint.toRequestInit("+7909@gmail.com", "qwerty")
}

let got: any
let expected: any
console.assert(
	(got = AnotherEndpoint.toURL({ id: "42" })).toString() ===
		(expected = "https://api.raison-qa.dev/api/v1/thing/42"),
	`Url path joined incorrectly`,
	{ got, expected }
)
console.assert(
	(got = BaseEndpoint.url("/{test}").build().toURL({ test: "321" })).toString() ===
		(expected = "https://api.raison-qa.dev/321"),
	`Url path joined incorrectly`,
	{ got, expected }
)
