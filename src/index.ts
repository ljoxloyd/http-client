import * as io from "io-ts";

interface EndpointInit<
    Path extends string,
    Method extends HttpRestMethod,
    Input extends any[],
    Output
> {
    readonly url: Path;
    readonly method: Method;
    readonly headers: Lazy<HeadersInit>;
    readonly options?: Omit<RequestInit, "body" | "method" | "headers">;
    readonly inputSelector: Selector<Input>;
    readonly outputDecoder: io.Decoder<any, Output>;
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
            headers: () => ({}),
            inputSelector: () => null,
            outputDecoder: io.unknown,
        });
    }

    toRequest(params: PathParametersObject<Path>, ...data: Input) {
        const url = this.toUrl(params);
        const init = this.toRequestInit(...data);
        return new Request(url, init);
    }

    toRequestInit(...data: Input) {
        let body: BodyInit | null;
        const rawBody = this.init.inputSelector(...data);
        if (
            rawBody === null ||
            typeof rawBody === "string" ||
            rawBody instanceof Blob ||
            rawBody instanceof FormData ||
            rawBody instanceof ReadableStream ||
            rawBody instanceof URLSearchParams ||
            rawBody instanceof ArrayBuffer ||
            isArrayBufferView(rawBody)
        ) {
            body = rawBody;
        } else {
            body = JSON.stringify(rawBody);
        }
        // prettier-ignore
        let headers = this.init.headers(),
            method  = this.init.method,
            options = this.init.options

        return { ...options, body, headers, method };
    }

    toUrl(params: PathParametersObject<Path>) {
        let url: string = this.init.url;
        for (const name of getPathParametersNames(this.init.url)) {
            url = url.replace(`/{${name}}`, "/" + params[name]);
        }
        return url;
    }

    toValidation(something: unknown) {
        return this.init.outputDecoder.decode(something);
    }

    toBuilder() {
        return new Builder(this.init);
    }
}

class Builder<Path extends string, Method extends HttpRestMethod, Input extends any[], Output> {
    constructor(private readonly init: EndpointInit<Path, Method, Input, Output>) {}

    url<NewPath extends string>(url: NewPath) {
        return new Builder({ ...this.init, url });
    }

    method<NewMethod extends HttpRestMethod>(method: NewMethod) {
        return new Builder({ ...this.init, method });
    }

    expects<NewInput extends any[]>(inputSelector: Selector<NewInput>) {
        return new Builder({ ...this.init, inputSelector });
    }

    returns<NewOutput>(outputDecoder: io.Decoder<any, NewOutput>) {
        return new Builder({ ...this.init, outputDecoder });
    }

    headers(headers: HeadersInit | { new (): Headers }) {
        return new Builder({
            ...this.init,
            headers: typeof headers !== "function" ? () => headers : () => new headers(),
        });
    }

    options(options: typeof this.init["options"]) {
        return new Builder({ ...this.init, options });
    }

    build(): Endpoint<Path, Method, Input, Output> {
        // @ts-expect-error because Endpoint constructor is private but builder must be able to construct it
        return new Endpoint(this.init);
    }
}

//
// ==== ==== ==== Utils ==== ==== ====

type Lazy<T> = () => T;

type Selector<T extends any[]> = (...params: T) => object | string | null;

function getPathParametersNames<Path extends string>(url: Path) {
    return (url.match(/(?<=\/\{)(\w+)(?=\})/g) ?? []) as Array<keyof PathParametersObject<Path>>;
}

function isArrayBufferView(body: object): body is ArrayBufferView {
    return "buffer" in body && body.buffer instanceof ArrayBuffer;
}

//
// ==== ==== ==== Enums ==== ==== ====

export type HttpRestQueryMethod = typeof HttpRestQueryMethod[keyof typeof HttpRestQueryMethod];
export const HttpRestQueryMethod = {
    Get: "GET",
    Head: "HEAD",
    Options: "OPTIONS",
} as const;

export type HttpRestMutationMethod =
    typeof HttpRestMutationMethod[keyof typeof HttpRestMutationMethod];
export const HttpRestMutationMethod = {
    Post: "POST",
    Put: "PUT",
    Patch: "PATCH",
    Delete: "DELETE",
} as const;

export type HttpRestMethod = typeof HttpRestMethod[keyof typeof HttpRestMethod];
export const HttpRestMethod = {
    ...HttpRestQueryMethod,
    ...HttpRestMutationMethod,
} as const;

//
// ==== ==== ==== Types ==== ==== ====

type PathParametersObject<Path extends string> = Record<PathParametersNames<Path>, string>;

type PathHasParams<Path extends string> = Path extends `${string}/{${string}}${string}`
    ? true
    : false;

type PathParametersNames<Path extends string> =
    Path extends `${string}/{${infer Arg}}${infer RestOfPath}`
        ? PathHasParams<RestOfPath> extends true
            ? Arg | PathParametersNames<RestOfPath>
            : Arg
        : never;

export type ParamsFor<E extends AnyEndpoint> = E extends Endpoint<infer U, any, any, any>
    ? PathParametersObject<U>
    : never;

export type InputFor<E extends AnyEndpoint> = E extends Endpoint<any, any, infer I, any>
    ? I
    : never;

export type OutputOf<E extends AnyEndpoint> = E extends Endpoint<any, any, any, infer O>
    ? O
    : never;

type AnyEndpoint = Endpoint<any, any, any, any>;

//
// ==== ==== ==== Tests ==== ==== ====

type RequestData = {
    login: string;
    password: string;
};

const ResponseData = io.type({
    success: io.boolean,
});
type ResponseData = io.TypeOf<typeof ResponseData>;

const MyApiEndpoint = Endpoint.url("/api/v1/{id}")
    .method("POST")
    .expects((data: RequestData) => data)
    .returns(ResponseData)
    .build();

MyApiEndpoint.toRequest({ id: "123" }, { login: "asd", password: "sd" });
//  ^?

const NewEndpoint = Endpoint.url("/api/v1/test")
    .returns(io.type({ whatever: io.number }))
    .expects(() => null)
    .build();

NewEndpoint.toRequest({});
//  ^?
