/**
 * npx ts-node dev/1.decorator.ts
 * =========================================================================================
 * POR QUE GETTERS, SETTERS E OBJECT.DEFINEPROPERTY?
 * =========================================================================================
 * 
 * Diferente do "Wrapper" simples, usar Getters nos permite interceptar o ACESSO ao método,
 * não apenas a sua execução.
 * 
 * Isso é fundamental para:
 * 1. Corrigir o contexto do 'this' (AutoBind).
 * 2. Laziness (fazer algo apenas na primeira vez que o método é tocado).
 * 3. Alterar a própria propriedade na instância dinamicamente.
 */

// =========================================================================================
// EXEMPLO 1: AUTOBIND (O Clássico)
// Resolve o problema do 'this' perdendo o contexto em callbacks ou eventos.
// =========================================================================================

function AutoBind(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    console.log("target", target);
    console.log("propertyKey", propertyKey);
    console.log("descriptor", descriptor);
    console.log("originalMethod", originalMethod);
    console.log("\n -------- \n")

    // Ajustamos o descriptor para usar um GETTER em vez de um VALUE fixo
    return {
        configurable: true,
        enumerable: false,
        // O getter roda quando alguém acessa: instancia.meuMetodo
        get() {
            console.log("this ---", this);
            // 'this' aqui refere-se à instância da classe (porque estamos acessando através dela)
            const boundFn = originalMethod.bind(this);
            console.log("boundFn ---", boundFn);

            // OTIMIZAÇÃO COM OBJECT.DEFINEPROPERTY:
            // Já que fizemos o bind, não precisamos rodar esse getter de novo.
            // Redefinimos a propriedade NA PRÓPRIA INSTÂNCIA com o valor fixo 'boundFn'.
            Object.defineProperty(this, propertyKey, {
                value: boundFn,
                configurable: true,
                writable: true,
                enumerable: false,
            });

            return boundFn;
        }
    };
}

// =========================================================================================
// EXEMPLO 2: ONE SHOT (Executar Apenas Uma Vez)
// Usa defineProperty para substituir o método por "null" ou lançar erro após o uso.
// =========================================================================================

function OneShot(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
        // Executa a lógica original
        const result = originalMethod.apply(this, args);

        // AGORA A MÁGICA:
        // Redefinimos a propriedade para que ela não seja mais a função original.
        Object.defineProperty(this, propertyKey, {
            value: () => {
                console.warn(`[OneShot] O método '${propertyKey}' já foi executado e não pode ser chamado novamente.`);
                return null;
            },
            configurable: true
            // writable: false // Poderíamos travar a edição se quiséssemos
        });

        return result;
    };
}

// =========================================================================================
// EXEMPLO 3: DEPRECATED (Aviso ao Acessar)
// Usa getter para avisar apenas de ler o método, mesmo que não execute.
// =========================================================================================

function Deprecated(mensagem: string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        console.log("target --- ", target);
        console.log("propertyKey --- ", propertyKey);
        console.log("descriptor --- ", descriptor);
        const originalMethod = descriptor.value;

        return {
            get() {
                console.warn(`[DEPRECATED] Cuidado! O método '${propertyKey}' está obsoleto: ${mensagem}`);
                // Retorna o método original para funcionar normalmente
                return originalMethod.bind(this); 
            }
        };
    };
}

// =========================================================================================
// TESTANDO OS CONCEITOS
// =========================================================================================

class ComponenteUI {
    public nome = "Botão Principal";

    @AutoBind
    click() {
        // Sem o AutoBind, 'this' seria undefined se chamado fora da classe
        console.log(`Clicado no: ${this.nome}`);
    }

    @OneShot
    inicializarSistema() {
        console.log("Iniciando conexões... Sistema Online!");
    }

    @Deprecated("Use o método 'novoMetodo()' em vez deste.")
    metodoAntigo() {
        console.log("Executando lógica legada...");
    }
}

// --- EXECUÇÃO ---

const componente = new ComponenteUI();

console.log("--- Teste 1: AutoBind ---");
const handleClick = componente.click; 
// Em JS normal, ao isolar a função, o 'this' se perderia.
// Com @AutoBind, o getter rodou e prendeu o this corretamente.
handleClick(); // Funciona: Clicado no Botão Principal


console.log("\n--- Teste 2: OneShot ---");
componente.inicializarSistema(); // Roda a primeira vez
componente.inicializarSistema(); // Roda a segunda vez (Aviso e não executa)


console.log("\n--- Teste 3: Deprecated (Apenas Acessando) ---");
// Só de acessar a propriedade para atribuir, o getter já dispara o aviso
const fn = componente.metodoAntigo; 
fn();
