import * as io from "io-ts";
import { isArrayBufferView, keys, lazy } from "./utils";

type HttpRestQueryMethod = typeof HttpRestQueryMethod[keyof typeof HttpRestQueryMethod];
const HttpRestQueryMethod = <const>{
    Get: "GET",
    Head: "HEAD",
    Options: "OPTIONS",
};

type HttpRestMutationMethod = typeof HttpRestMutationMethod[keyof typeof HttpRestMutationMethod];
const HttpRestMutationMethod = <const>{
    Post: "POST",
    Put: "PUT",
    Patch: "PATCH",
    Delete: "DELETE",
};

type HttpRestMethod = typeof HttpRestMethod[keyof typeof HttpRestMethod];
const HttpRestMethod = <const>{
    ...HttpRestQueryMethod,
    ...HttpRestMutationMethod,
};

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

// TODO: thing who to conveniently reuse headers
export class Endpoint<
    Path extends string,
    Method extends HttpRestMethod,
    Input extends any[],
    Output
> {
    constructor(private readonly init: EndpointInit<Path, Method, Input, Output>) {}

    static url<Url extends string>(url: Url) {
        return new Builder({
            url,
            method: "GET",
            headers: lazy({}),
            inputSelector: lazy(null),
            outputDecoder: io.any,
        });
    }

    toRequest(params: PathParams<Path>, ...data: Input) {
        // prettier-ignore
        let url     = this.toUrl(params),
            body    = this.toRequestBody(...data),
            headers = this.init.headers(),
            method  = this.init.method,
            options = this.init.options

        return new Request(url, { ...options, body, headers, method });
    }

    toRequestBody(...data: Input) {
        const body = this.init.inputSelector(...data);
        if (
            body === null ||
            typeof body === "string" ||
            body instanceof Blob ||
            body instanceof FormData ||
            body instanceof ReadableStream ||
            body instanceof URLSearchParams ||
            body instanceof ArrayBuffer ||
            isArrayBufferView(body)
        ) {
            return body;
        } else {
            return JSON.stringify(body);
        }
    }

    toUrl(params: PathParams<Path>) {
        let url: string = this.init.url;
        keys(params).forEach((key) => {
            url = url.replace(`{${key}}`, params[key]);
        });
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

    // should parser instead of guard for better validation errors
    returns<NewOutput>(isOutput: io.Decoder<any, NewOutput>) {
        return new Builder({ ...this.init, outputDecoder: isOutput });
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

    build() {
        return new Endpoint(this.init);
    }
}

//
// ==== ==== ==== Types ==== ==== ====

type PathParams<Url extends string> = Record<PathParamsKeys<Url>, string>;

type Lazy<T> = () => T;

type Selector<T extends any[]> = (...params: T) => object | string | null;

//
// ==== ==== ==== Infers ==== ==== ====

type RequestArguments<Path extends string, Input extends any[]> = {} extends PathParams<Path>
    ? [...data: Input]
    : [params: PathParams<Path>, ...data: Input];

type HasParams<Url extends string> = Url extends `${string}/{${string}}${string}` ? true : false;

type PathParamsKeys<Url extends string> = Url extends `${string}/{${infer Arg}}${infer RestOfUrl}`
    ? HasParams<RestOfUrl> extends true
        ? Arg | PathParamsKeys<RestOfUrl>
        : Arg
    : never;

export type BodyFor<E> = E extends Endpoint<any, any, infer I, any> ? I : never;

export type ParamsFor<E> = E extends Endpoint<infer U, any, any, any> ? PathParams<U> : never;

export type OutputOf<E> = E extends Endpoint<any, any, any, infer O> ? O : never;

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

const NewEndpoint = Endpoint.url("/api/v1/test").build();

NewEndpoint.toRequest({});
//  ^?
