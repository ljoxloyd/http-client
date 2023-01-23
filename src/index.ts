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
    onCreated: (request: Request) => Request | void;

    /**
     *  Runs after request, if it was successful
     *
     * @param response - has no access to body to prevent consuming it early
     * @returns nothing to leave response untouched or new Response instance to substitute request result
     */
    onSuccess: (response: Omit<Response, keyof Body>) => Response | void;

    /**
     * Runs after request, if error was thrown
     *
     * @param failure anything that was thrown in previous hooks, during fetch or while consuming body
     * @returns any other error you deem to fit, **avoid throwing inside this hook**
     */
    onFailure: (failure: unknown) => unknown | void;
    /**
     * Runs unconditionally after request
     *
     * @returns nothing
     */
    onSettled: () => void;
};

class Middleware {
    private constructor(private readonly hooks: HookSequences) {}

    static create(hooks: Partial<Hooks> = {}) {
        return new Middleware(HookSequences.from(hooks));
    }

    static extend(client: Middleware, hooks: Partial<Hooks> = {}) {
        return new Middleware(HookSequences.concat(client.hooks, HookSequences.from(hooks)));
    }

    public async call<E extends Endpoint<any, any, any, any>>(
        endpoint: E,
        params: ParamsFor<E>,
        body: BodyFor<E>
        // @ts-expect-error TODO
    ): Promise<OutputOf<E>> {
        const request = endpoint.toRequest(params, body);
        const response = await this.send(request);
        const result = endpoint.toParser(await response.json());
    }

    public async send(request: Request): Promise<Response> {
        const { onCreated, onSuccess, onFailure, onSettled } = this.hooks;
        try {
            for (const hook of onCreated) {
                request = hook(request) ?? request;
            }
            let response = await fetch(request);
            for (const hook of onSuccess) {
                response = hook(response) ?? response;
            }
            return response;
        } catch (failure) {
            for (const hook of onFailure) {
                failure = hook(failure) ?? failure;
            }
            throw failure;
        } finally {
            for (const hook of onSettled) {
                hook();
            }
        }
    }
}

type HookSequences = { [Key in keyof Hooks]: Array<Hooks[Key]> };
namespace HookSequences {
    export function from(hooks: Partial<Hooks>): HookSequences {
        return {
            onCreated: hooks.onCreated ? [hooks.onCreated] : [],
            onSuccess: hooks.onSuccess ? [hooks.onSuccess] : [],
            onFailure: hooks.onFailure ? [hooks.onFailure] : [],
            onSettled: hooks.onSettled ? [hooks.onSettled] : [],
        };
    }

    export function concat(target: HookSequences, source: HookSequences) {
        return {
            onCreated: target.onCreated.concat(source.onCreated),
            onSuccess: target.onSuccess.concat(source.onSuccess),
            onFailure: target.onFailure.concat(source.onFailure),
            onSettled: target.onSettled.concat(source.onSettled),
        };
    }
}

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

interface EndpointConfig<Path extends string, Method extends HttpRestMethod, Input, Output> {
    readonly url: Path;
    readonly method: Method;
    readonly headers: Lazy<HeadersInit>;
    readonly options?: Omit<RequestInit, "body" | "method" | "headers">;
    readonly inputKey: InferenceKey<Input>;
    readonly isOutput: Predicate<Output>;
}

// TODO: thing who to conveniently reuse headers
class Endpoint<Path extends string, Method extends HttpRestMethod, Input, Output> {
    constructor(private readonly config: EndpointConfig<Path, Method, Input, Output>) {}

    static readonly defaults: EndpointConfig<"/", "GET", any, any> = {
        url: "/",
        method: "GET",
        headers: () => ({}),
        inputKey: Symbol(),
        isOutput: (d): d is any => true,
    };

    static url<Url extends string>(url: Url) {
        return new Builder({ ...this.defaults, url });
    }

    toRequest(params: PathParams<Path>, data: Input) {
        // prettier-ignore
        let url     = this.toUrl(params),
            method  = this.config.method,
            headers = this.config.headers(),
            options = this.config.options,
            body    = JSON.stringify(data);
        return new Request(url, { ...options, body, headers, method });
    }

    toUrl(params: PathParams<Path>) {
        let url: string = this.config.url;
        Object.keys(params).forEach((key) => {
            url = url.replace(`{${key}}`, Reflect.get(params, key));
        });
        return url;
    }

    toParser(something: unknown): something is Output {
        return this.config.isOutput(something);
    }
}

class Builder<Path extends string, Method extends HttpRestMethod, Input, Output> {
    constructor(private readonly config: EndpointConfig<Path, Method, Input, Output>) {}

    url<NewPath extends string>(url: NewPath) {
        return new Builder({
            ...this.config,
            url,
        });
    }

    method<NewMethod extends HttpRestMethod>(method: NewMethod) {
        return new Builder({
            ...this.config,
            method,
        });
    }

    expects<NewInput>() {
        return new Builder({
            ...this.config,
            inputKey: Symbol() as InferenceKey<NewInput>,
        });
    }

    // should parser instead of guard for better validation errors
    returns<NewOutput>(guard: Guard<NewOutput>) {
        return new Builder({
            ...this.config,
            isOutput: "is" in guard ? guard.is : guard,
        });
    }

    headers(headers: HeadersInit | { new (): Headers }) {
        return new Builder({
            ...this.config,
            headers: typeof headers !== "function" ? () => headers : () => new headers(),
        });
    }

    options(options: typeof this.config["options"]) {
        return new Builder({ ...this.config, options });
    }

    build() {
        return new Endpoint(this.config);
    }
}

// ==== ==== ==== Types ==== ==== ====

type PathParamsKeys<Url extends string> = Url extends `${string}/{${infer Arg}}${infer RestOfUrl}`
    ? HasParams<RestOfUrl> extends true
        ? Arg | PathParamsKeys<RestOfUrl>
        : Arg
    : never;

type HasParams<Url extends string> = Url extends `${string}/{${string}}${string}` ? true : false;

type PathParams<Url extends string> = Record<PathParamsKeys<Url>, string>;

type BodyFor<E> = E extends Endpoint<any, any, infer I, any> ? I : never;

type ParamsFor<E> = E extends Endpoint<infer U, any, any, any> ? PathParams<U> : never;

type OutputOf<E> = E extends Endpoint<any, any, any, infer O> ? O : never;

type Lazy<T> = () => T;

interface InferenceKey<T> extends Symbol {}

interface Confirmable<Output> {
    is: (data: any) => data is Output;
}

type Predicate<T> = (data: any) => data is T;

type Guard<Output> = Confirmable<Output> | Predicate<Output>;

// ==== ==== ==== Tests ==== ==== ====

let endpoint = Endpoint.url("/another/{thing}")
    .expects<{ qwe: 123 }>()
    .returns({ is: (d): d is "ReSpOnSe" => true })
    .build();

Middleware.create().call(endpoint, { thing: "any string" }, { qwe: 123 });
//                       ^?
