const finalWord = "eject"

type Finalizer<R> = {
    [K in typeof finalWord]: () => R
}

export type BuilderOf<Thing, Original = Thing> = {
    [Prop in keyof Thing]-?: {
        (value: Thing[Prop]): BuilderOf<Omit<Thing, Prop>, Original>
        (): Thing[Prop]
    }
} & ({} extends Thing ? Finalizer<Readonly<Original>> : {})

function builder<T extends Record<string | symbol, any>>() {
    const built: Record<string | symbol, unknown> = {}

    const guard = Symbol()

    const getter: ProxyHandler<{}> = {
        get(_, property) {
            if (property === finalWord) {
                return () => built
            }

            return (value: unknown = guard) => {
                if (value === guard) {
                    return built[property]
                } else {
                    built[property] = value
                    return builder
                }
            }
        },
    }

    const builder = new Proxy(Object.create(null), getter) as BuilderOf<T>

    return builder
}

interface TestData {
    id: number
    name: string
    bool: boolean
}

const result = builder<TestData>().id(123).name("asd").bool(false).eject()
//      ^?
