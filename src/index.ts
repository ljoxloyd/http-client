import * as io from "io-ts"

interface EndpointInit<
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
	readonly baseUrl: string
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
	private constructor(private readonly init: EndpointInit<Url, Method, Input, Output>) {}

	static base(baseUrl: string | URL, baseInitOptions?: EndpointRequestInit) {
		return new Builder({
			url: "/",
			baseUrl: baseUrl instanceof URL ? baseUrl.toString() : baseUrl,
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
	toRequest(params: UrlParametersObject<Url>, ...data: Input) {
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
            method = this.init.method,
            options = this.init.options

		return { ...options, body, method, headers }
	}

	toUrl(params: UrlParametersObject<Url>) {
		let url: string = this.init.url
		for (const name of getUrlParametersNames(this.init.url)) {
			url = url.replace(`/{${name}}`, "/" + params[name])
		}

		return pathJoin(this.init.baseUrl, url)
	}

	toValidation(something: unknown) {
		return this.init.outputDecoder.decode(something)
	}

	toBuilder() {
		return new Builder(this.init)
	}
}

class Builder<Url extends string, Method extends HttpRestMethod, Input extends any[], Output> {
	constructor(private readonly init: EndpointInit<Url, Method, Input, Output>) {}

	build(): Endpoint<Url, Method, Input, Output> {
		// @ts-expect-error because Endpoint constructor is private but builder must be able to construct it
		return new Endpoint(this.init)
	}

	url<NewPath extends PathString>(url: NewPath) {
		return new Builder({ ...this.init, url })
	}

	method<NewMethod extends HttpRestMethod>(method: NewMethod) {
		return new Builder({ ...this.init, method })
	}

	expects<NewInput extends any[]>(inputSelector: InputSelector<NewInput>) {
		return new Builder({ ...this.init, inputSelector })
	}

	returns<NewOutput>(outputDecoder: io.Decoder<any, NewOutput>) {
		return new Builder({ ...this.init, outputDecoder })
	}

	headers(headers: HeadersInit | { new (): Headers }) {
		if (typeof headers === "function") {
			return new Builder({ ...this.init, headersGetter: () => new headers() })
		}
		const headersGetter = () => ({
			...this.init.headersGetter(),
			...headers,
		})
		return new Builder({ ...this.init, headersGetter })
	}

	options(options: EndpointRequestInit) {
		return new Builder({
			...this.init,
			options: { ...this.init.options, ...options },
		})
	}
}

//
// ==== ==== ==== Utils ==== ==== ====

const optionalTrailingSlash = /(\/)?$/
const optionalLeadingSlash = /^(\/)?/

function pathJoin(baseUrl: string, url: string) {
	return baseUrl.replace(optionalTrailingSlash, url.replace(optionalLeadingSlash, "/"))
}

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

AnotherEndpoint.toUrl(
	// @ts-expect-error no id
	{}
)
AnotherEndpoint.toUrl({
	// @ts-expect-error incorrect parameters
	anything: 42,
})
// correct
AnotherEndpoint.toUrl({ id: "42" })

// @ts-expect-error login and password not passed
MyApiEndpoint.toRequestInit()
MyApiEndpoint.toRequestInit(
	"+7909@gmail.com",
	// @ts-expect-error incorrect password type passed
	123456
)
// correct
MyApiEndpoint.toRequestInit("+7909@gmail.com", "qwerty")

let got: any
let expected: any
console.assert(
	(got = AnotherEndpoint.toUrl({ id: "42" })) ===
		(expected = "https://api.raison-qa.dev/api/v1/thing/42"),
	`Url path joined incorrectly`,
	{ got, expected }
)
console.assert(
	(got = BaseEndpoint.url("/{test}").build().toUrl({ test: "321" })) ===
		(expected = "1https://api.raison-qa.dev/321"),
	`Url path joined incorrectly`,
	{ got, expected }
)
