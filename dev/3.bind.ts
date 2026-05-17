/**
 * =========================================================================================
 * ENTENDENDO O MÉTODO .BIND() EM JAVASCRIPT/TYPESCRIPT
 * =========================================================================================
 * 
 * O problema que o .bind() resolve:
 * Em JavaScript, o valor de 'this' dentro de uma função depende de COMO a função é chamada,
 * e não de onde ela foi definida.
 * 
 * Se você pega um método de um objeto e o passa como callback (para um botão, timer, etc),
 * ele perde a conexão com o objeto original, e o 'this' vira undefined (ou global em alguns casos).
 * 
 * O .bind() cria uma NOVA função com o 'this' TRAVADO permanentemente no objeto que você escolher.
 */

// =========================================================================================
// EXEMPLO 1: O PROBLEMA CLÁSSICO (Perda do 'this')
// =========================================================================================

class CaixaEletronico {
    private saldo: number = 1000;

    constructor(private banco: string) {}

    sacar(valor: number) {
        // Tenta acessar 'this.banco' e 'this.saldo'
        // Se 'this' for undefined, isso vai quebrar!
        if (this === undefined) {
             console.log("[ERRO CRÍTICO] 'this' é undefined! Perdi a referência ao objeto.");
             return;
        }

        if (valor > this.saldo) {
            console.log(`[${this.banco}] Saldo insuficiente.`);
        } else {
            this.saldo -= valor;
            console.log(`[${this.banco}] Saque de R$${valor} realizado. Novo saldo: R$${this.saldo}`);
        }
    }
}

const minhaConta = new CaixaEletronico("Nubank");

// Chamada normal: Funciona porque quem chamou foi 'minhaConta.'
console.log("--- Chamada Direta ---");
minhaConta.sacar(100); 

// O PROBLEMA: Simulando um callback (como em um evento de clique ou timer)
// Ao atribuir o método a uma variável solta, perdemos a referência 'minhaConta.'
const funcaoSolta = minhaConta.sacar;

console.log("\n--- Chamada Solta (Sem Bind) ---");
try {
    funcaoSolta(100); // Erro! Quem é 'this'?
} catch (e: any) {
    console.log("Erro capturado:", e.message);
}

// =========================================================================================
// EXEMPLO 2: A SOLUÇÃO COM .BIND()
// =========================================================================================

console.log("\n--- Chamada Com Bind (Resolvido) ---");

// Criamos uma NOVA função onde 'this' é forçado a ser 'minhaConta'
const funcaoComBind = minhaConta.sacar.bind(minhaConta);

funcaoComBind(200); // Agora funciona perfeitamente!
funcaoComBind(50);

// =========================================================================================
// EXEMPLO 3: BIND PARA ARGUMENTOS PARCIAIS (Currying)
// O .bind() não serve só para o 'this', ele também pode pré-definir argumentos!
// =========================================================================================

console.log("\n--- Bônus: Bind com Argumentos (Currying) ---");

function multiplicar(a: number, b: number) {
    return a * b;
}

// O primeiro argumento do bind é o 'this' (aqui null pois não usamos 'this' na função)
// O segundo argumento é o valor de 'a' fixado
const duplicar = multiplicar.bind(null, 2); 

// Agora só precisamos passar o 'b', pois 'a' já é 2 fixo
console.log("Duplicar 5:", duplicar(5)); // 2 * 5 = 10
console.log("Duplicar 10:", duplicar(10)); // 2 * 10 = 20

const triplicar = multiplicar.bind(null, 3);
console.log("Triplicar 5:", triplicar(5)); // 3 * 5 = 15
