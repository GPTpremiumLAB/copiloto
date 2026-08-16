# Pesquisa de APIs de mapas, rotas e trânsito

Atualizado em 14 de agosto de 2026. Valores são em USD e devem ser confirmados antes da contratação.

## Recomendação executiva

Para o primeiro piloto no Brasil, usar **HERE Routing como rota principal**, **TomTom Routing/Traffic como segunda opinião** e **Valhalla + OpenStreetMap como referência independente e futura rota de redução de custos**.

Não começar com Waze como núcleo: o Waze Transport SDK exige parceria, não fornece acesso servidor a servidor, não incorpora mapa/navegação e declara que não serve para construir outro aplicativo de navegação. Waze Deep Links pode apenas abrir o aplicativo Waze.

Google Routes tem boa proposta para trânsito e motocicleta, mas sua licença exige cuidado especial: conteúdo da Routes API não pode ser exibido junto de mapa não Google, há regras de atribuição e restrições de cache. Isso dificulta um comparador neutro de vários provedores. Recomenda-se avaliá-lo em uma prova separada, após revisão jurídica.

## Comparação

| Provedor | Trânsito em tempo real | Motocicleta | Navegação móvel | Liberdade operacional | Papel recomendado |
|---|---:|---:|---:|---:|---|
| HERE | Sim, ao vivo e histórico | Two-wheeler/scooter | HERE SDK Navigate (comercial) | Média/alta | Provedor principal |
| TomTom | Sim, fluxo e incidentes | Sim, mas beta na API v1; Orbis atual limita-se a carro | SDKs/serviços próprios | Média/alta | Segunda opinião e incidentes |
| Google Routes | Sim | Sim em produto/nível compatível | Navigation SDK | Baixa para mistura de fontes | Experimento isolado |
| Mapbox | Sim no perfil `driving-traffic` | Sem perfil separado; automóvel inclui moto genericamente | Navigation SDK Android/iOS | Média | Excelente UI/navegação, menor diferenciação para moto |
| GraphHopper | Depende do plano/dados (OSM ou TomTom) | Personalizável | Instruções; app exige mais construção | Alta | Alternativa hospedada e customizável |
| Valhalla | Não traz tráfego comercial pronto; aceita operação própria | Perfil específico, ainda beta | Instruções por texto/voz | Muito alta | Motor independente/self-hosted |
| openrouteservice | Não é forte em trânsito ao vivo | Perfis OSM, sem destaque para moto | Sem SDK completo comparável | Alta | Protótipos e análises |
| OSRM | Não nativamente em tempo real | Exige perfil/preparo próprio | Motor de rotas, não produto de navegação | Muito alta | Rotas simples de baixo custo |
| Apple MapKit | ETA e direções para carro/a pé | Sem modo dedicado público | Forte apenas no ecossistema Apple | Baixa/média | Complemento iOS, não backend principal |
| Waze | Excelente, mas acesso restrito | Navegação no app Waze | Troca para o Waze | Muito baixa | Deep Link/parceria futura |

## Provedores prioritários

### 1. HERE

- Routing API v8 considera trânsito ao vivo, histórico e restrições dependentes do horário.
- Tem modos e limites publicados para carro, scooter/two-wheeler, caminhão e outros.
- Plano limitado informa até 1.000 requisições por dia sem dados de pagamento e 10 RPS para routing; certos usos de rastreamento e alertas de segurança exigem contrato.
- O SDK Navigate tem contratação própria, portanto o custo final de navegação guiada precisa de proposta comercial.

Conclusão: melhor base técnica para nossa arquitetura por oferecer trânsito, variedade de veículos e menor conflito conceitual com um motor próprio de decisão.

### 2. TomTom

- Routing API usa trânsito atual por padrão e também considera padrões históricos.
- Traffic API oferece fluxo e incidentes separadamente, o que é útil para o nosso motor de IA.
- A API v1 possui modo `motorcycle` em beta, inclusive rotas `thrilling` configuráveis por curvas e relevo.
- A geração Orbis mais recente ainda declara suporte de `travelMode` apenas para carro. Precisamos confirmar o roadmap de motocicleta antes de escolher a versão.

Conclusão: excelente segunda fonte para trânsito e rotas de carro; motocicleta deve passar por validação de cobertura e estabilidade em Salvador.

### 3. Valhalla + OpenStreetMap

- Código aberto, APIs REST, rotas, matriz, otimização, map matching e instruções de voz/texto.
- Perfil `motorcycle` permite ajustar preferência entre turismo por estrada e trilhas, mas é marcado beta.
- Não entrega sozinho o mesmo nível de trânsito ao vivo dos provedores comerciais; exige infraestrutura, atualização do grafo e uma fonte externa de velocidades/incidentes.

Conclusão: importante como terceira opinião, fallback e proteção contra dependência comercial. Não deve ser a única fonte no primeiro MVP de trânsito ao vivo.

## Outras opções

### Google Maps Platform

- Routes oferece trânsito e rotas para veículos motorizados de duas rodas em ofertas compatíveis.
- Preço publicado: Compute Routes Essentials inclui 10 mil chamadas gratuitas/mês e começa em US$ 5 por mil; Pro inclui 5 mil e começa em US$ 10 por mil; Enterprise inclui 1 mil e começa em US$ 15 por mil. Navigation Request começa em US$ 25 por mil após 1 mil gratuitas.
- Resultados de Routes exibidos em mapa devem seguir as regras de mapa/atribuição do Google; termos específicos vedam uso do conteúdo Google em conjunto com mapa não Google e limitam cache de coordenadas.

Conclusão: tecnicamente forte, mas a estratégia multi-provedor precisa ser desenhada com revisão contratual antes da integração.

### Mapbox

- Directions API possui `driving-traffic`, alternativas, congestionamento, incidentes e instruções.
- O perfil automotivo serve genericamente para carro/caminhão/moto, mas não há um perfil público dedicado a motocicleta.
- Até 100 mil chamadas mensais de Directions aparecem como gratuitas; depois, US$ 2 por mil no primeiro nível publicado.
- Navigation SDK v2 publica cobrança a partir de US$ 0,30 por usuário ativo e US$ 0,08 por viagem, depois das franquias; v3/unlimited requer contato comercial após 10 usuários.

Conclusão: ótimo para construir rapidamente uma experiência visual elegante, porém HERE/TomTom são mais interessantes para nossa proposta focada em diferenças entre carro e moto.

### GraphHopper, openrouteservice e OSRM

- São úteis para evitar dependência de uma única empresa e permitem customizar o custo das vias.
- GraphHopper tem serviço hospedado, matrizes, otimização, geocoding e custom models, com OSM ou TomTom como fonte conforme oferta.
- openrouteservice fornece Directions, Matrix, Isochrones e formatos JSON/GeoJSON/GPX.
- OSRM é rápido e maduro para rotas OSM, mas perfis são preparados estaticamente e trânsito ao vivo exige trabalho próprio.

Conclusão: testar Valhalla primeiro para moto; manter GraphHopper como alternativa se não quisermos operar infraestrutura.

## Arquitetura proposta

1. Consultar HERE e TomTom em paralelo no backend.
2. Normalizar cada rota sem misturar geometrias ou dados protegidos entre fornecedores.
3. Calcular uma pontuação própria usando duração, confiança, incidentes, pedágios, complexidade e adequação ao veículo.
4. Mostrar a origem de cada alternativa e a atribuição exigida.
5. Usar Valhalla/OSM como sinal independente e fallback, inicialmente sem prometer trânsito ao vivo.
6. Recalcular por evento relevante, desvio ou intervalo controlado; evitar atualizações que distraiam o condutor.

## Prova de conceito recomendada

- Área: Salvador e Região Metropolitana.
- Cenários: 30 pares origem/destino, horários de pico e fora de pico, carro e motocicleta.
- Métricas: erro de ETA, incidentes detectados, estabilidade da rota, tempo de resposta, custo por viagem e qualidade das instruções.
- Duração: duas semanas de coleta sem usuários finais, seguida de teste fechado.
- Decisão: selecionar o provedor principal pelos dados reais, não apenas pelo catálogo comercial.

## Fontes oficiais

- [HERE: trânsito no Routing API v8](https://docs.here.com/routing/docs/routing-v8-traffic-in-routing)
- [HERE: limites e usos excluídos](https://www.here.com/get-started/pricing/rps-limits-excluded-use-cases)
- [TomTom: parâmetros de routing, trânsito e motocicleta](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/common-routing-parameters)
- [TomTom: Traffic API](https://developer.tomtom.com/traffic-api/documentation/tomtom-maps/v1/product-information/introduction)
- [TomTom: migração para Orbis](https://developer.tomtom.com/routing-api/documentation/tomtom-orbis-maps/v3/product-information/migration-guide)
- [Google Maps Platform: preços](https://developers.google.com/maps/billing-and-pricing/pricing?hl=pt-BR)
- [Google Routes: políticas e atribuição](https://developers.google.com/maps/documentation/routes/policies)
- [Google Maps Platform: termos específicos de Routes](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240515)
- [Mapbox: Directions API](https://docs.mapbox.com/api/navigation/directions/)
- [Mapbox: preços](https://www.mapbox.com/pricing)
- [Waze Transport SDK e suas limitações](https://developers.google.com/waze/intro-transport)
- [Valhalla: APIs](https://valhalla.github.io/valhalla/api/)
- [GraphHopper Directions API](https://docs.graphhopper.com/openapi/section/explore-our-apis/api-explorer)
- [openrouteservice API](https://openrouteservice.org/dev/)
- [OSRM API](https://project-osrm.org/docs/v5.9.1/api/)
- [Apple MapKit Directions](https://developer.apple.com/documentation/mapkit/mkdirections)

