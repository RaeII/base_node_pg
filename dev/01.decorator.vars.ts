/**
 * =========================================================================================
 * PROPERTY DECORATORS (Decorators de Propriedades/Variáveis)
 * =========================================================================================
 * 
 * Diferente dos decorators de método, os Property Decorators NÃO têm acesso ao
 * valor da propriedade no momento da decoração (porque ela ainda não foi inicializada instanciada).
 * 
 * ELES RECEBEM APENAS 2 ARGUMENTOS:
 * 1. O Prototype da classe (para instâncias) ou a Função Construtora (para estáticos).
 * 2. O Nome da Propriedade (string).
 * 
 * NÃO recebem o PropertyDescriptor por padrão.
 * 
 * PARA QUE SERVEM ENTÃO?
 * 1. Validação de metadados (marcar campos como obrigatórios, email, etc).
 * 2. Modificar o comportamento de acesso (Getters/Setters) redefinindo a propriedade.
 */

// =========================================================================================
// EXEMPLO 1: VALIDAÇÃO SIMPLES (MinLength)
// Cria um getter/setter que valida o valor ao ser atribuído.
// =========================================================================================

function MinLength(min: number) {
    return function (target: any, propertyKey: string) {
        let valorPrivado: string;

        // Redefinimos a propriedade na própria instância quando ela for criada
        // Mas como só temos acesso ao prototype aqui, precisamos de um truque:
        // O Object.defineProperty no target (prototype) define para TODAS as instâncias?
        // NÃO! Precisamos definir um getter/setter que opere no 'this' da instância.

        const getter = function () {
            return valorPrivado;
        };

        const setter = function (novoValor: string) {
            if (novoValor.length < min) {
                console.log(`[ERRO] O campo '${propertyKey}' precisa ter no mínimo ${min} caracteres.`);
                // Poderíamos lançar erro: throw new Error(...)
                return; // Ignora a atribuição
            }
            console.log(`[OK] Atribuindo '${novoValor}' para '${propertyKey}'`);
            valorPrivado = novoValor;
        };

        // Redefinimos a propriedade no PROTOTYPE para ter esse comportamento
        Object.defineProperty(target, propertyKey, {
            get: getter,
            set: setter,
            enumerable: true,
            configurable: true
        });
    };
}

// =========================================================================================
// EXEMPLO 2: FORMATADOR (UpperCase / Trim)
// Modifica o dado antes de salvar.
// =========================================================================================

function UpperCase(target: any, propertyKey: string) {
    let valor: string;

    Object.defineProperty(target, propertyKey, {
        get: () => valor,
        set: (novoValor: string) => {
            valor = novoValor.toUpperCase();
            console.log(`[FORMAT] Convertendo '${novoValor}' para '${valor}'`);
        },
        enumerable: true,
        configurable: true
    });
}

// O problema do "let valor" acima é que ele é COMPARTILHADO por todas as instâncias (closure no prototype).
// VAMOS CORRIGIR ISSO NO EXEMPLO 3 (A Forma Correta de Criar Estado por Instância).

// =========================================================================================
// EXEMPLO 3: A FORMA CORRETA (State per Instance)
// Usando um WeakMap ou definindo a propriedade na PRÓPRIA instância no primeiro acesso.
// =========================================================================================

function MaxValue(max: number) {
    return function(target: any, propertyKey: string) {
        
        // Em vez de substituir no prototype direto com uma variável global,
        // definimos a propriedade como CONFIGURÁVEL.
        
        Object.defineProperty(target, propertyKey, {
            configurable: true,
            enumerable: true,
            // O segredo: No primeiro SET, nós "matamos" essa definição do prototype
            // e criamos uma propriedade exclusiva NA INSTÂNCIA (this).
            set(valorInicial: number) {
                let valorAtual = valorInicial;
                
                // Redefine a propriedade APENAS NESTA INSTÂNCIA ('this')
                Object.defineProperty(this, propertyKey, {
                    enumerable: true,
                    configurable: true,
                    get: () => valorAtual,
                    set: (novoValor: number) => {
                        if (novoValor > max) {
                            console.log(`[LIMIT] O valor ${novoValor} excede o máximo de ${max}. Travando em ${max}.`);
                            valorAtual = max;
                        } else {
                            valorAtual = novoValor;
                        }
                    }
                });
                
                // Roda a lógica do setter pela primeira vez (para validar o valor inicial)
                this[propertyKey] = valorInicial; 
            }
        });
    }
}

// =========================================================================================
// TESTANDO NA CLASSE
// =========================================================================================

class UsuarioCadastro {
    @MinLength(5)
    nome: string;

    @UpperCase
    codigo: string;

    @MaxValue(100)
    idade: number;

    constructor(nome: string, codigo: string, idade: number) {
        this.nome = nome;   // Dispara o Setter do MinLength
        this.codigo = codigo; // Dispara o Setter do UpperCase
        this.idade = idade;   // Dispara o Setter do MaxValue
    }
}

console.log("--- Criando Usuario 1 (Dados Válidos) ---");
const u1 = new UsuarioCadastro("Rafael", "abc", 25);
console.log("Usuário 1:", { nome: u1.nome, codigo: u1.codigo, idade: u1.idade });

console.log("\n--- Criando Usuario 2 (Dados Inválidos) ---");
const u2 = new UsuarioCadastro("Zen", "xyz", 150); // Nome curto, idade alta
console.log("Usuário 2:", { nome: u2.nome, codigo: u2.codigo, idade: u2.idade });

// Testando correção do Exemplo 2 (O bug do estado compartilhado)
// Se o exemplo 2 estivesse errado, alterar u2 mudaria u1?
console.log("\n--- Teste de Isolamento ---");
u1.codigo = "teste";
console.log("U1 Codigo:", u1.codigo); // TESTE
console.log("U2 Codigo:", u2.codigo); // XYZ (Se mostrar TESTE, temos um bug de closure compartilhada!)

// OBS: No Exemplo 2 eu usei closure simples no prototype.
// Isso significa que todas as instâncias compartilham a MESMA variável `valor`.
// Vamos ver isso acontecer:
console.log("!!! OCORREU O BUG DO EXEMPLO 2? !!!");
console.log(u1.codigo === u2.codigo ? "SIM! O Exemplo 2 compartilha estado (Incorreto para props de instância)." : "NÃO.");
