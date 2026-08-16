# Assistente de pilotagem inteligente

Base de um assistente que consulta vários provedores de rotas e trânsito, normaliza as respostas e recomenda o melhor caminho para carro ou motocicleta.

## Princípio do produto

A IA não inventa ruas nem substitui as regras de trânsito. Os provedores calculam rotas válidas; o motor de decisão compara tempo, confiabilidade, incidentes, pedágios, complexidade e restrições do veículo. Durante o trajeto, uma nova rota só deve ser sugerida quando o ganho for relevante e a mudança puder ser comunicada com segurança.

## Arquitetura do MVP

1. Aplicativo móvel envia origem, destino, veículo e preferências.
2. Adaptadores consultam provedores de mapas em paralelo.
3. Uma camada comum converte todas as respostas para o mesmo formato.
4. O recomendador pontua rotas, elimina opções incompatíveis e explica a escolha.
5. Um monitor recebe atualizações de trânsito e recalcula apenas quando necessário.

O protótipo implementa conectores para HERE, TomTom e Valhalla, além de dois provedores simulados para desenvolvimento sem credenciais.

Consulte a [pesquisa comparativa de APIs](docs/pesquisa-apis.md) para a seleção dos provedores do piloto.

## Executar

Requer Node.js 20 ou superior.

No Windows, dê dois cliques em `iniciar.cmd` ou execute pelo CMD:

```text
iniciar.cmd
```

O comando inicia a API e abre a interface em `http://localhost:3000`.

Execução manual:

```text
npm install
npm test
npm start
```

Copie `.env.example` para `.env` e preencha as chaves desejadas. A API consulta todos os provedores configurados em paralelo. Sem credenciais, o modo `auto` usa simulação; `ROUTE_PROVIDER_MODE=live` impede esse fallback.

Exemplo de requisição:

```json
POST /v1/recommendations
{
  "origin": { "lat": -12.97, "lng": -38.51 },
  "destination": { "lat": -12.90, "lng": -38.40 },
  "vehicle": "motorcycle",
  "preferences": { "avoidTolls": true, "simpleRoute": true }
}
```

## Próximos marcos

- Escolher dois provedores iniciais conforme cobertura, licença e custo no Brasil.
- Implementar adaptadores reais, cache e limites de uso.
- Criar acompanhamento de viagem e regras contra recálculos excessivos.
- Construir aplicativo móvel com mapa, voz e comandos mínimos durante a condução.
- Registrar consentimento e proteger localização, histórico e credenciais.
- Testar em Salvador e região metropolitana antes de ampliar a cobertura.

## Limites importantes

- Dados de localização são sensíveis e devem ter retenção curta e consentimento explícito.
- Termos de cada provedor podem restringir combinação, armazenamento ou exibição de seus dados.
- Recomendações nunca devem incentivar excesso de velocidade, conversões proibidas ou interação manual enquanto o veículo estiver em movimento.
- Aviação exigiria outro produto, fontes certificadas e requisitos regulatórios próprios.
