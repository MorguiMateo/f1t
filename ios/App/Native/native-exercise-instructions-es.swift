import Foundation

/// Offline, exercise-specific Spanish summaries. Not a literal translation or runtime translator.
/// The original free-exercise-db instructions/images remain available with their attribution.
/// New catalog entries require an explicit ID and an authored guide; never guess from the name.
enum NativeExerciseInstructionsES {
    static let attribution = "Guía breve en español adaptada para F1t. Catálogo e imágenes: free-exercise-db (Unlicense)."
    static func steps(for exerciseID: String) -> [String]? { guides[exerciseID] }

    private static let guides: [String: [String]] = {
        var result: [String: [String]] = [:]
        func add(_ variants: [(String, String)], _ movement: String, _ finish: String) {
            for (id, setup) in variants { result[id] = [setup, movement, finish] }
        }
        add([
            ("Crunches", "Acostate boca arriba con las rodillas flexionadas, los pies apoyados y las manos suaves junto a la cabeza."),
            ("Decline_Crunch", "Asegurá los pies en el banco declinado y acostate boca arriba, con las manos junto a la cabeza."),
            ("Exercise_Ball_Crunch", "Apoyá la zona lumbar sobre la pelota, con los pies firmes y separados para estabilizarte.")
        ], "Contraé el abdomen y levantá los hombros acercando las costillas a la pelvis, sin tirar del cuello.", "Hacé una pausa y bajá lentamente, sin tomar impulso.")
        add([("Sit-Up", "Acostate boca arriba con las rodillas flexionadas y los pies estabilizados; mantené las manos cerca del pecho o de la cabeza sin tirar del cuello.")],
            "Elevá el torso hacia los muslos mientras soltás el aire.", "Bajá con control hasta la posición inicial.")
        add([("Ab_Crunch_Machine", "Ajustá el asiento y los apoyos de la máquina abdominal y sujetá los agarres.")],
            "Flexioná el tronco contrayendo el abdomen, sin impulsar la carga con los brazos.", "Volvé despacio sin dejar caer las placas.")
        add([("Cable_Crunch", "Arrodillate frente a una polea alta y sujetá la cuerda junto a la cabeza.")],
            "Acercá las costillas a la pelvis flexionando el tronco; mantené las caderas y los brazos estables.", "Volvé con control sin perder la tensión abdominal.")
        add([("Reverse_Crunch", "Acostate boca arriba, apoyá los brazos y elevá las piernas con las rodillas flexionadas.")],
            "Contraé el abdomen para despegar suavemente la pelvis y acercar las rodillas al pecho.", "Bajá la pelvis lentamente sin balancear las piernas.")
        add([("Dead_Bug", "Acostate boca arriba con los brazos hacia el techo y las caderas y rodillas a 90°.")],
            "Mantené la zona lumbar apoyada mientras extendés una pierna hacia el suelo, sin arquear la espalda.", "Volvé al inicio y alterná las piernas con control.")
        add([("Air_Bike", "Acostate boca arriba, colocá las manos suavemente junto a la cabeza y levantá las piernas.")],
            "Acercá una rodilla al codo contrario mientras extendés la otra pierna y girás el torso.", "Alterná los lados sin tirar del cuello ni tomar impulso.")
        add([("Thigh_Abductor", "Sentate en la máquina de abductores, con la espalda apoyada y las almohadillas contra la parte externa de las piernas.")],
            "Separá las piernas contra la resistencia manteniendo el torso quieto.", "Cerrá lentamente, sin golpear las placas.")
        add([("Thigh_Adductor", "Sentate en la máquina de aductores con las almohadillas contra la parte interna de los muslos.")],
            "Acercá las piernas entre sí manteniendo la espalda apoyada.", "Abrí de nuevo con control, dentro de un recorrido cómodo.")
        // The upstream Band_Hip_Adductions description incorrectly describes abduction.
        // This is an authored guide to the named adduction exercise, not a claimed literal translation.
        add([("Band_Hip_Adductions", "Anclá una banda a un soporte firme, colocala en el tobillo más cercano al anclaje y sostenete para mantener el equilibrio.")],
            "Llevá esa pierna hacia el centro y cruzala suavemente delante de la pierna de apoyo, sin girar la pelvis.", "Volvé despacio hacia el anclaje y repetí del otro lado.")
        add([("Band_Pull_Apart", "Sostené una banda frente al pecho con los brazos extendidos y las manos separadas.")],
            "Separá las manos llevando la banda hacia el pecho y juntando los omóplatos, sin encoger los hombros.", "Volvé despacio manteniendo los brazos a la misma altura.")
        add([
            ("Dumbbell_Flyes", "Acostate en un banco plano con una mancuerna en cada mano sobre el pecho y los codos ligeramente flexionados."),
            ("Incline_Dumbbell_Flyes", "Apoyate en un banco inclinado con las mancuernas sobre el pecho y los codos ligeramente flexionados.")
        ], "Abrí los brazos en un arco hasta un recorrido cómodo, manteniendo el mismo ángulo de los codos.", "Volvé a juntar las mancuernas sobre el pecho sin chocarlas.")
        add([
            ("Reverse_Flyes", "Sostené dos mancuernas e incliná el torso desde las caderas, con la espalda estable y los codos levemente flexionados."),
            ("Cable_Rear_Delt_Fly", "Ubicate entre dos poleas altas y sujetá los agarres cruzados, uno con cada mano.")
        ], "Abrí los brazos hacia los lados con los codos ligeramente flexionados, sin elevar los hombros ni balancear el torso.", "Volvé lentamente a la posición inicial.")
        add([("Reverse_Machine_Flyes", "Sentate mirando al respaldo de la máquina de aperturas posteriores y sujetá los agarres a la altura de los hombros.")],
            "Abrí los brazos hacia atrás manteniendo el pecho apoyado y los hombros bajos.", "Volvé despacio sin soltar la carga.")
        add([
            ("Good_Morning", "Colocá la barra sobre la espalda alta, no sobre el cuello, y separá los pies al ancho de las caderas con las rodillas levemente flexionadas."),
            ("Stiff_Leg_Barbell_Good_Morning", "Colocá la barra sobre la espalda alta y mantené las piernas casi extendidas, sin bloquear las rodillas.")
        ], "Llevá las caderas hacia atrás e incliná el torso manteniendo la espalda estable; no busques más profundidad de la que podés controlar.", "Extendé las caderas para volver de pie sin arquear la zona lumbar.")
        add([("Monster_Walk", "Colocá bandas alrededor de los tobillos y las rodillas, con tensión al separar los pies al ancho de los hombros.")],
            "Dá pasos cortos hacia adelante, manteniendo separación entre las piernas y el tronco estable.", "Retrocedé con pasos controlados sin dejar que las rodillas se junten.")
        add([("Clean", "Con la barra cerca de las espinillas, tomala por fuera de las piernas y prepará una postura estable con el pecho elevado.")],
            "Despegá la barra extendiendo las piernas; al pasar las rodillas, acelerá con la extensión de caderas, rodillas y tobillos.", "Metete debajo de la barra y recibila sobre los hombros en sentadilla frontal, con los codos altos. Levantate manteniendo el equilibrio.")
        add([("Power_Clean", "Colocá la barra cerca de las espinillas, tomala por fuera de las piernas y mantené la espalda estable.")],
            "Elevá la barra cerca del cuerpo y acelerá con las caderas y las piernas, sin iniciar el tirón doblando los brazos.", "Recibí la barra sobre los hombros con los codos altos en una sentadilla parcial; luego extendé las piernas y bajá la barra con control.")
        add([
            ("Cable_Crossover", "Ubicate entre dos poleas altas, sujetá sus agarres y adelantá un pie para estabilizarte."),
            ("Low_Cable_Crossover", "Ubicate entre dos poleas bajas y sujetá sus agarres con las palmas hacia adelante, estabilizando el torso.")
        ], "Acercá las manos delante del pecho siguiendo un arco, con los codos levemente flexionados y sin balancearte.", "Abrí los brazos de nuevo con control, manteniendo tensión en los cables.")
        add([("Isometric_Neck_Exercise_-_Front_And_Back", "Sentate o parate con la cabeza neutra y apoyá una mano en la frente.")],
            "Presioná suavemente contra la mano sin mover la cabeza y respirando normalmente.", "Soltá la presión gradualmente y repetí con la mano detrás de la cabeza, sin forzar el cuello.")
        add([("Isometric_Neck_Exercise_-_Sides", "Con la cabeza neutra, apoyá una mano en un lateral de la cabeza.")],
            "Presioná suavemente contra la mano sin inclinar ni girar la cabeza; respiración normal.", "Soltá la presión gradualmente y repetí del otro lado.")
        add([
            ("Dumbbell_Alternate_Bicep_Curl", "Parate con una mancuerna en cada mano, los brazos a los lados y los codos junto al torso. Trabajá un brazo por vez."),
            ("Barbell_Curl", "Tomá una barra con las palmas hacia arriba, los brazos a los lados y los pies firmes."),
            ("EZ-Bar_Curl", "Sujetá la barra Z por sus zonas anguladas, con las palmas hacia arriba y los codos junto al torso."),
            ("Dumbbell_Bicep_Curl", "Parate con una mancuerna en cada mano y las palmas hacia adelante, manteniendo los codos junto al torso."),
            ("Standing_Biceps_Cable_Curl", "Sujetá el agarre de una polea baja con las palmas hacia arriba y parate con el torso estable."),
            ("Incline_Dumbbell_Curl", "Apoyá la espalda en un banco inclinado y dejá los brazos colgando con una mancuerna en cada mano."),
            ("Reverse_Barbell_Curl", "Sujetá una barra con las palmas hacia abajo y los codos junto al cuerpo."),
            ("Hammer_Curls", "Sostené las mancuernas a los lados con las palmas enfrentadas y los codos cerca del cuerpo.")
        ], "Flexioná los codos para elevar la carga sin mover los brazos hacia adelante ni balancear el torso.", "Bajá despacio hasta la posición inicial, manteniendo las muñecas alineadas.")
        add([
            ("Spider_Curl", "Apoyá el pecho sobre el banco inclinado de curl araña y sujetá la barra con las palmas hacia arriba, dejando los brazos orientados hacia abajo."),
            ("Preacher_Curl", "Sentate en el banco predicador, apoyá los brazos en la almohadilla y tomá la barra con las palmas hacia arriba."),
            ("Cable_Preacher_Curl", "Apoyá los brazos en el banco predicador y tomá el agarre de la polea baja con las palmas hacia arriba."),
            ("Machine_Bicep_Curl", "Ajustá la máquina para apoyar los brazos y alinear los codos con su eje; sujetá los agarres.")
        ], "Flexioná los codos para acercar la carga sin despegar los brazos del apoyo.", "Extendé los codos lentamente sin forzar el final del recorrido ni dejar caer la carga.")
        add([("Concentration_Curls", "Sentate con las piernas separadas, apoyá el brazo por dentro del muslo y sostené una mancuerna con la palma hacia arriba.")],
            "Flexioná el codo sin mover el brazo de su apoyo.", "Bajá con control y completá también el otro brazo.")
        add([("Zottman_Curl", "Parate con una mancuerna en cada mano, las palmas hacia adelante y los codos junto al torso.")],
            "Subí flexionando los codos con las palmas hacia arriba; arriba, girá las manos para que queden hacia abajo.", "Bajá lentamente con ese agarre y volvé a girar las manos al llegar al inicio.")
        add([
            ("Palms-Down_Wrist_Curl_Over_A_Bench", "Apoyá los antebrazos en un banco, con las muñecas fuera del borde y una barra tomada con las palmas hacia abajo."),
            ("Seated_Dumbbell_Palms-Up_Wrist_Curl", "Sentate con los antebrazos sobre los muslos y las muñecas fuera del apoyo; sostené las mancuernas con las palmas hacia arriba."),
            ("Palms-Up_Barbell_Wrist_Curl_Over_A_Bench", "Apoyá los antebrazos en un banco, dejando las muñecas fuera del borde; sujetá la barra con las palmas hacia arriba.")
        ], "Mové solo las muñecas para elevar la carga dentro de un recorrido cómodo.", "Bajá despacio sin despegar los antebrazos del apoyo.")
        add([("Wrist_Roller", "Sostené el enrollador de muñeca frente al cuerpo con la cuerda extendida y la carga suspendida.")],
            "Alterná la rotación de las muñecas para enrollar la cuerda y subir la carga.", "Desenrollá lentamente sin dejar caer el peso.")
        add([
            ("Standing_Leg_Curl", "Ajustá la máquina de curl de pie, apoyá el muslo y colocá la almohadilla detrás del tobillo de la pierna que trabaja."),
            ("Seated_Leg_Curl", "Sentate en la máquina de curl femoral con la espalda apoyada, el muslo sujeto y la almohadilla detrás de los tobillos."),
            ("Lying_Leg_Curls", "Acostate boca abajo en la máquina de curl femoral y colocá los tobillos debajo de la almohadilla.")
        ], "Flexioná las rodillas para acercar los talones hacia los glúteos sin mover las caderas.", "Extendé las piernas lentamente sin golpear las placas; si es unilateral, completá ambos lados.")
        add([("Ball_Leg_Curl", "Acostate boca arriba con los talones sobre una pelota y elevá las caderas formando una línea con el torso.")],
            "Flexioná las rodillas para acercar la pelota, manteniendo las caderas elevadas.", "Extendé las piernas con control sin dejar caer la pelvis.")
        add([
            ("V-Bar_Pullup", "Colocá un agarre en V estable sobre la barra de dominadas y sujetalo con ambas manos."),
            ("Chin-Up", "Colgate de una barra con las palmas hacia vos, aproximadamente al ancho de los hombros."),
            ("Pullups", "Colgate de una barra con las palmas hacia adelante y un agarre cómodo algo mayor que el ancho de hombros."),
            ("Weighted_Pull_Ups", "Asegurá el lastre y colgate de una barra de dominadas con un agarre firme y las palmas hacia adelante.")
        ], "Elevá el cuerpo acercando el pecho a la barra, llevando los codos hacia abajo y sin balancearte.", "Bajá con control hasta extender los brazos dentro de un recorrido cómodo.")
        add([
            ("Standing_Calf_Raises", "Ajustá la máquina de gemelos de pie y apoyá la parte delantera de los pies en la plataforma, dejando libres los talones."),
            ("Standing_Barbell_Calf_Raise", "Colocá la barra sobre la espalda alta y apoyá la parte delantera de los pies en un soporte estable con los talones libres."),
            ("Standing_Dumbbell_Calf_Raise", "Sostené una mancuerna y apoyá la parte delantera del pie en un soporte estable; usá la mano libre para equilibrarte."),
            ("Calf_Press_On_The_Leg_Press_Machine", "Sentate en la prensa con el respaldo apoyado y la parte delantera de los pies sobre la plataforma; mantené las rodillas casi extendidas."),
            ("Smith_Machine_Calf_Raise", "Colocá la barra Smith sobre la espalda alta y apoyá la parte delantera de los pies en una plataforma estable."),
            ("Seated_Calf_Raise", "Sentate en la máquina de gemelos con las almohadillas sobre los muslos y la parte delantera de los pies en la plataforma.")
        ], "Elevá los talones empujando con la parte delantera de los pies, sin cambiar el ángulo de las rodillas.", "Bajá los talones lentamente dentro de un recorrido cómodo, sin rebotar.")
        add([("Glute_Ham_Raise", "Ajustá el banco de glúteos e isquios, fijá los pies entre los rodillos y apoyá los muslos con las rodillas junto al borde de la almohadilla.")],
            "Flexioná las rodillas para elevar el torso, manteniendo alineados tronco y caderas.", "Bajá con control sin doblar la zona lumbar.")
        add([
            ("Hanging_Leg_Raise", "Colgate de una barra estable con los brazos extendidos y el cuerpo sin balanceo."),
            ("Flat_Bench_Lying_Leg_Raise", "Acostate boca arriba sobre un banco, sujetá sus bordes y dejá las piernas extendidas.")
        ], "Elevá las piernas usando el abdomen, sin arquear la espalda ni tomar impulso.", "Bajá lentamente y detené el recorrido antes de perder el control de la pelvis.")
        add([("Front_Dumbbell_Raise", "Parate con una mancuerna en cada mano frente a los muslos y las rodillas levemente flexionadas.")],
            "Elevá los brazos hacia adelante hasta una altura cómoda próxima a los hombros, con los codos ligeramente flexionados.", "Bajá lentamente sin balancear el torso; podés alternar los brazos.")
        add([
            ("Side_Lateral_Raise", "Parate con una mancuerna en cada mano a los lados y los codos ligeramente flexionados."),
            ("Seated_Side_Lateral_Raise", "Sentate en un banco con una mancuerna en cada mano a los lados y los pies firmes.")
        ], "Elevá los brazos hacia los lados hasta aproximadamente la altura de los hombros, sin encogerlos.", "Bajá despacio manteniendo el torso quieto.")
        add([
            ("Barbell_Shrug", "Parate con una barra frente a los muslos y los brazos extendidos."),
            ("Dumbbell_Shrug", "Parate con una mancuerna en cada mano a los lados y los brazos extendidos."),
            ("Cable_Shrugs", "Sujetá el agarre de una polea baja y parate con los brazos extendidos.")
        ], "Elevá los hombros hacia arriba sin doblar los codos ni girar el cuello.", "Hacé una pausa y bajá lentamente, sin hacer círculos con los hombros.")
        add([("Leg_Extensions", "Ajustá la máquina de extensión para alinear las rodillas con el eje y colocar la almohadilla delante de los tobillos.")],
            "Extendé las rodillas para elevar la carga manteniendo la espalda y los muslos apoyados.", "Bajá con control sin golpear las placas.")
        add([
            ("Standing_Dumbbell_Triceps_Extension", "Parate y sostené una mancuerna por encima de la cabeza con ambas manos; mantené el abdomen firme."),
            ("Seated_Triceps_Press", "Sentate en un banco y sostené una mancuerna sobre la cabeza con ambas manos, con los codos orientados hacia arriba."),
            ("Cable_Rope_Overhead_Triceps_Extension", "Sujetá la cuerda de una polea, orientate de espaldas a ella y colocá los brazos por encima de la cabeza.")
        ], "Flexioná los codos para llevar la carga detrás de la cabeza sin mover los brazos ni arquear la espalda.", "Extendé los codos para volver al inicio, manteniendo un recorrido cómodo.")
        add([
            ("Triceps_Pushdown", "Parate frente a una polea alta y sujetá la barra con las palmas hacia abajo y los codos junto al torso."),
            ("Triceps_Pushdown_-_Rope_Attachment", "Parate frente a una polea alta y sujetá la cuerda con las palmas enfrentadas y los codos junto al cuerpo."),
            ("Machine_Triceps_Extension", "Ajustá el asiento de la máquina de tríceps, apoyá los brazos y alineá los codos con su eje.")
        ], "Extendé los codos sin mover los brazos de su posición ni empujar con el torso.", "Volvé lentamente flexionando los codos, sin dejar caer la carga.")
        add([("Face_Pull", "Colocá una cuerda en la polea a la altura de la cara y sujetala con ambas manos, dando un paso atrás.")],
            "Llevá la cuerda hacia la cara separando las manos y orientando los codos hacia los lados, sin encoger los hombros.", "Extendé los brazos lentamente sin balancear el torso.")
        add([
            ("Pushups", "Apoyá las manos en el suelo algo más abiertas que los hombros y alineá cabeza, torso y piernas."),
            ("Incline_Push-Up", "Apoyá las manos en un banco o soporte elevado firme y mantené el cuerpo alineado.")
        ], "Flexioná los codos para acercar el pecho al apoyo sin dejar caer las caderas.", "Empujá para volver al inicio manteniendo el abdomen firme.")
        add([("Bench_Dips", "Sentate en el borde de un banco firme, apoyá las manos a los lados y adelantá los pies para sacar las caderas del banco.")],
            "Flexioná los codos para bajar cerca del banco, solo hasta un recorrido cómodo para los hombros.", "Extendé los codos para subir sin alejar el torso del banco.")
        add([
            ("Parallel_Bar_Dip", "Sostenete entre dos barras paralelas estables con los brazos extendidos y el cuerpo sin balanceo."),
            ("Dips_-_Chest_Version", "Sostenete en las paralelas e incliná ligeramente el torso hacia adelante para la variante de pecho."),
            ("Dips_-_Triceps_Version", "Sostenete en las paralelas con el torso más erguido y los codos cerca del cuerpo para la variante de tríceps.")
        ], "Flexioná los codos para bajar el cuerpo hasta un recorrido cómodo para los hombros, sin balancearte.", "Empujá las barras para volver al inicio manteniendo la postura.")
        add([("Russian_Twist", "Sentate con las rodillas flexionadas, incliná ligeramente el torso hacia atrás y sostené las manos o una carga frente al pecho.")],
            "Girá el torso hacia un lado y luego al otro, manteniendo el abdomen firme y la pelvis estable.", "Movete con control, sin sacudir la espalda; apoyá los pies si necesitás más estabilidad.")
        add([("Barbell_Hip_Thrust", "Apoyá la espalda alta en un banco firme, colocá una barra acolchada sobre las caderas y apoyá los pies en el suelo.")],
            "Extendé las caderas hasta alinear el torso con los muslos, contrayendo los glúteos sin arquear la zona lumbar.", "Bajá la pelvis lentamente manteniendo el banco y los pies estables.")
        add([("Hyperextensions_Back_Extensions", "Ajustá el banco de extensiones para apoyar los muslos dejando libres las caderas; fijá los pies.")],
            "Incliná el torso desde las caderas con la espalda estable hasta un recorrido que controles.", "Extendé las caderas para volver a la línea del cuerpo sin sobreextender la espalda.")
        add([
            ("One_Arm_Lat_Pulldown", "Sentate frente a una polea alta y sujetá un agarre con una mano, manteniendo el torso estable."),
            ("Wide-Grip_Lat_Pulldown", "Sentate con los muslos bajo los apoyos y tomá la barra de la polea alta con un agarre ancho y las palmas hacia adelante."),
            ("Close-Grip_Front_Lat_Pulldown", "Sentate en la polea alta con los muslos sujetos y tomá el agarre cerrado."),
            ("Underhand_Cable_Pulldowns", "Sentate en la polea alta con los muslos sujetos y tomá la barra con las palmas hacia vos.")
        ], "Llevá el agarre hacia la parte alta del pecho bajando los codos, sin tirar detrás de la nuca ni balancear el torso.", "Extendé los brazos lentamente; en la variante unilateral, completá ambos lados.")
        add([("Straight-Arm_Pulldown", "Parate frente a una polea alta y tomá el agarre con los brazos casi extendidos y el torso levemente inclinado.")],
            "Llevá el agarre hacia los muslos sin cambiar el ángulo de los codos ni balancearte.", "Volvé despacio hasta un recorrido cómodo para los hombros.")
        add([("Standing_Cable_Wood_Chop", "Parate de costado a una polea alta y sujetá el agarre con ambas manos, con los pies firmes.")],
            "Llevá el agarre en diagonal hacia la cadera opuesta, girando de manera controlada el torso y las caderas.", "Volvé lentamente hacia la polea y completá ambos lados.")
        add([("Glute_Kickback", "Apoyá manos y rodillas en el suelo, con la espalda estable y una rodilla flexionada.")],
            "Elevá esa pierna hacia atrás desde la cadera manteniendo la rodilla flexionada, sin arquear la zona lumbar.", "Bajá con control y completá también el otro lado.")
        add([("One-Legged_Cable_Kickback", "Colocá una tobillera en la polea baja, sujetá un apoyo firme y estabilizá el torso.")],
            "Llevá la pierna hacia atrás desde la cadera sin girar la pelvis ni arquear la espalda.", "Volvé lentamente y cambiá de pierna.")
        add([("Tricep_Dumbbell_Kickback", "Apoyá una mano y una rodilla en un banco, incliná el torso y sostené la mancuerna con el brazo junto al cuerpo y el codo flexionado.")],
            "Extendé el codo llevando la mancuerna hacia atrás, sin mover el brazo.", "Volvé despacio y completá ambos lados.")
        add([("Butterfly", "Ajustá el asiento del pec deck para que los brazos queden a una altura cómoda y apoyá la espalda.")],
            "Acercá los agarres o almohadillas delante del pecho sin levantar los hombros.", "Abrí lentamente sin forzar el recorrido de los hombros.")
        add([
            ("Barbell_Deadlift", "Colocá la barra cerca de las espinillas, tomala por fuera de las piernas y prepará el torso firme con los pies al ancho de caderas."),
            ("Trap_Bar_Deadlift", "Parate dentro de la barra hexagonal y sujetá sus agarres laterales, con el torso firme y los pies equilibrados."),
            ("Deficit_Deadlift", "Parate sobre una plataforma baja y estable; sujetá la barra cercana a las espinillas sin perder la postura de la espalda."),
            ("Sumo_Deadlift", "Separá ampliamente los pies con las puntas hacia afuera y tomá la barra entre las piernas, cerca de las espinillas.")
        ], "Empujá el suelo y extendé las rodillas y las caderas para levantarte, manteniendo la carga cerca y el torso firme.", "Volvé al suelo flexionando las caderas y luego las rodillas, sin redondear ni sobreextender la espalda.")
        add([
            ("Stiff-Legged_Barbell_Deadlift", "Sostené una barra frente a los muslos con las piernas casi extendidas, sin bloquear las rodillas."),
            ("Stiff-Legged_Dumbbell_Deadlift", "Sostené las mancuernas frente a los muslos con las piernas casi extendidas y el torso firme."),
            ("Romanian_Deadlift", "Parate con una barra frente a los muslos y las rodillas levemente flexionadas.")
        ], "Llevá las caderas hacia atrás y bajá la carga cerca de las piernas hasta notar tensión en los isquios sin perder la postura.", "Extendé las caderas para volver de pie sin arquear la espalda al terminar.")
        add([("Plate_Pinch", "Tomá uno o varios discos por sus caras lisas entre los dedos y el pulgar, manteniéndolos cerca del suelo.")],
            "Sostené los discos con el brazo a un lado y la muñeca alineada durante el tiempo indicado.", "Apoyalos con control y repetí con la otra mano.")
        add([("Plank", "Apoyá los antebrazos y las puntas de los pies, con los codos debajo de los hombros.")],
            "Mantené cabeza, torso y piernas alineados contrayendo el abdomen y los glúteos.", "Respirá normalmente durante el tiempo indicado y terminá antes de perder la postura.")
        add([("Side_Bridge", "Acostate de lado y apoyá el antebrazo con el codo debajo del hombro; colocá los pies uno sobre otro o escalonados.")],
            "Elevá la pelvis para alinear el cuerpo y mantené el abdomen firme sin rotar el torso.", "Sostené el tiempo indicado, bajá con control y repetí del otro lado.")
        add([
            ("Narrow_Stance_Leg_Press", "Sentate en la prensa con la espalda apoyada y los pies relativamente juntos en la plataforma, en una posición estable."),
            ("Leg_Press", "Sentate en la prensa con la espalda y la pelvis apoyadas, colocando los pies aproximadamente al ancho de los hombros.")
        ], "Liberá los seguros y flexioná las rodillas hasta un recorrido que no despegue la pelvis del respaldo.", "Empujá con todo el pie para extender las piernas sin bloquear las rodillas; colocá los seguros al terminar.")
        add([("Arnold_Dumbbell_Press", "Sentate con una mancuerna en cada mano frente a los hombros y las palmas hacia vos.")],
            "Elevá las mancuernas mientras girás las palmas hacia adelante hasta extender los brazos cómodamente.", "Bajá con control invirtiendo el giro, sin arquear la espalda.")
        add([
            ("Close-Grip_Barbell_Bench_Press", "Acostate en un banco plano, apoyá los pies y sujetá la barra con un agarre cercano al ancho de los hombros."),
            ("Barbell_Bench_Press_-_Medium_Grip", "Acostate en un banco plano con los pies firmes y sujetá la barra con un agarre algo mayor que el ancho de hombros."),
            ("Wide-Grip_Barbell_Bench_Press", "Acostate en un banco plano con los pies firmes y tomá la barra con un agarre ancho que mantenga las muñecas alineadas."),
            ("Decline_Barbell_Bench_Press", "Asegurá las piernas en el banco declinado, apoyá la espalda y sujetá la barra con un agarre cómodo."),
            ("Barbell_Incline_Bench_Press_-_Medium_Grip", "Apoyate en un banco inclinado con los pies firmes y sujetá la barra con un agarre algo mayor que el ancho de hombros.")
        ], "Sacá la barra del soporte y bajala hacia el pecho con las muñecas alineadas y los omóplatos estables.", "Empujá para volver a extender los brazos sin rebotar la barra sobre el pecho; devolvela al soporte al terminar.")
        add([
            ("Dumbbell_Bench_Press", "Acostate en un banco plano con los pies firmes y una mancuerna a cada lado del pecho."),
            ("Incline_Dumbbell_Press", "Apoyate en un banco inclinado y colocá las mancuernas a los lados del pecho."),
            ("Dumbbell_Floor_Press", "Acostate en el suelo con las rodillas flexionadas y las mancuernas a los lados del pecho.")
        ], "Empujá las mancuernas hacia arriba manteniendo las muñecas alineadas y el torso estable.", "Bajá con control; en el suelo, apoyá suavemente los brazos sin rebotar.")
        add([("Machine_Bench_Press", "Ajustá el asiento para que los agarres queden cerca de la altura del pecho y apoyá la espalda.")],
            "Empujá los agarres hacia adelante sin levantar los hombros ni despegarte del respaldo.", "Volvé lentamente sin dejar caer las placas.")
        add([
            ("Lying_Triceps_Press", "Acostate en un banco y sostené una barra sobre el pecho con un agarre cerrado y los brazos orientados hacia arriba."),
            ("EZ-Bar_Skullcrusher", "Acostate en un banco y sostené una barra Z sobre el pecho con los brazos hacia arriba y los codos estables.")
        ], "Flexioná los codos para bajar la barra hacia la frente dentro de un recorrido controlado, sin mover los brazos.", "Extendé los codos para volver a la posición inicial.")
        add([
            ("Dumbbell_Shoulder_Press", "Sostené las mancuernas a los lados de los hombros, con los pies firmes y el torso estable."),
            ("Seated_Dumbbell_Press", "Sentate en un banco con respaldo y colocá una mancuerna a cada lado de los hombros."),
            ("Barbell_Shoulder_Press", "Sostené la barra frente a los hombros con un agarre algo mayor que su ancho y el torso firme."),
            ("Standing_Military_Press", "Parate con los pies estables y sujetá la barra frente a los hombros, contrayendo abdomen y glúteos."),
            ("Machine_Shoulder_Military_Press", "Ajustá la máquina de hombros para que los agarres queden junto a los hombros y apoyá la espalda."),
            ("Seated_Barbell_Military_Press", "Sentate con la espalda apoyada y tomá la barra frente a los hombros con un agarre cómodo.")
        ], "Empujá la carga por encima de la cabeza sin arquear la zona lumbar ni impulsar con las piernas.", "Bajá despacio hasta la posición inicial manteniendo las muñecas alineadas.")
        add([("Pallof_Press", "Parate de costado a una polea y sujetá el agarre con ambas manos frente al pecho, con los pies separados al ancho de caderas.")],
            "Extendé los brazos al frente y resistí el giro que provoca el cable, manteniendo el abdomen firme.", "Volvé al pecho con control y completá ambos lados.")
        add([
            ("Butt_Lift_Bridge", "Acostate boca arriba con las rodillas flexionadas y los pies apoyados cerca de los glúteos."),
            ("Single_Leg_Glute_Bridge", "Acostate boca arriba con una rodilla flexionada y ese pie apoyado; mantené la otra pierna elevada."),
            ("Barbell_Glute_Bridge", "Acostate boca arriba con las rodillas flexionadas, los pies apoyados y una barra acolchada sobre las caderas.")
        ], "Elevá la pelvis contrayendo los glúteos hasta alinear torso y muslos, sin arquear la zona lumbar.", "Bajá con control; en la variante unilateral, completá ambas piernas.")
        add([("Pull_Through", "Parate de espaldas a una polea baja, sujetá su cuerda entre las piernas y adelantate hasta que haya tensión.")],
            "Llevá las caderas hacia atrás con las rodillas levemente flexionadas, manteniendo la espalda estable.", "Extendé las caderas para volver de pie, sin tirar con los brazos ni arquear la espalda.")
        add([("Straight-Arm_Dumbbell_Pullover", "Apoyá la espalda alta en un banco, estabilizá los pies y sostené una mancuerna sobre el pecho con ambas manos.")],
            "Bajá la mancuerna detrás de la cabeza con los codos ligeramente flexionados, solo dentro de un recorrido cómodo para los hombros.", "Volvé a llevarla sobre el pecho sin arquear la zona lumbar.")
        add([("Push_Press", "Parate con la barra sobre la parte delantera de los hombros, los pies estables y el abdomen firme.")],
            "Flexioná brevemente las rodillas con el torso erguido y extendé las piernas para impulsar la barra; continuá empujando con los brazos.", "Recibí la barra por encima de la cabeza con el cuerpo estable y bajala con control hacia los hombros.")
        add([("Rack_Pulls", "Colocá la barra sobre los soportes del rack a la altura elegida, cerca de las piernas, y sujetala con el torso firme.")],
            "Extendé las caderas y las rodillas para levantar la barra manteniéndola cerca del cuerpo.", "Bajá con control hasta los soportes sin redondear la espalda ni rebotar.")
        add([("One-Arm_Dumbbell_Row", "Apoyá una mano y una rodilla en un banco, manteniendo el torso estable, y sostené la mancuerna con el brazo libre.")],
            "Llevá el codo hacia atrás acercando la mancuerna al costado, sin girar el torso.", "Extendé el brazo lentamente y completá ambos lados.")
        add([
            ("Upright_Barbell_Row", "Parate y sujetá una barra frente a los muslos con las palmas hacia el cuerpo."),
            ("Standing_Dumbbell_Upright_Row", "Parate con dos mancuernas frente a los muslos y las palmas hacia el cuerpo."),
            ("Upright_Cable_Row", "Sujetá el agarre de una polea baja con las palmas hacia el cuerpo y parate con el torso estable.")
        ], "Elevá la carga cerca del cuerpo guiando con los codos, solo hasta una altura cómoda para los hombros.", "Bajá despacio sin balancearte ni forzar el recorrido.")
        add([("Leverage_High_Row", "Ajustá el asiento y los apoyos del remo alto para alcanzar los agarres superiores y estabilizar el cuerpo.")],
            "Llevá los agarres hacia el torso bajando los codos y juntando los omóplatos, sin balancearte.", "Extendé los brazos lentamente sin dejar caer la carga.")
        add([
            ("Bent_Over_Barbell_Row", "Sostené una barra con las palmas hacia abajo e incliná el torso desde las caderas con las rodillas algo flexionadas."),
            ("Bent_Over_Two-Dumbbell_Row", "Sostené dos mancuernas e incliná el torso desde las caderas manteniendo la espalda estable."),
            ("Reverse_Grip_Bent-Over_Rows", "Tomá la barra con las palmas hacia adelante e incliná el torso desde las caderas con la espalda estable."),
            ("T-Bar_Row_with_Handle", "Colocá el agarre bajo la barra en T, sujetalo con ambas manos e incliná el torso desde las caderas.")
        ], "Llevá los codos hacia atrás para acercar la carga al torso sin cambiar la inclinación de la espalda.", "Extendé los brazos lentamente sin usar impulso.")
        add([("Lying_T-Bar_Row", "Ajustá el apoyo del remo en T, apoyá el pecho y sujetá los agarres con los pies estables.")],
            "Llevá los codos hacia atrás acercando la carga al torso sin despegar el pecho.", "Bajá con control hasta extender los brazos cómodamente.")
        add([("Inverted_Row", "Colocate debajo de una barra fija estable, sujetala y alineá el cuerpo con los talones apoyados.")],
            "Acercá el pecho a la barra flexionando los codos y juntando los omóplatos, sin dejar caer las caderas.", "Bajá lentamente manteniendo el cuerpo alineado.")
        add([
            ("Seated_One-arm_Cable_Pulley_Rows", "Sentate frente a la polea baja, apoyá los pies y sujetá el agarre con una mano y el torso erguido."),
            ("Seated_Cable_Rows", "Sentate frente a la polea baja con los pies firmes y sujetá el agarre con ambas manos y la espalda estable.")
        ], "Llevá los codos hacia atrás acercando el agarre al torso, sin balancearte ni girar las caderas.", "Extendé los brazos con control; en la variante unilateral, completá ambos lados.")
        add([("Ab_Roller", "Arrodillate sobre una superficie cómoda y sujetá la rueda delante de vos con el abdomen firme.")],
            "Rodá hacia adelante solo hasta donde puedas mantener estable la zona lumbar, sin dejar caer las caderas.", "Volvé lentamente usando el abdomen y manteniendo el control de la rueda.")
        add([("Box_Squat", "Colocá un cajón estable detrás de vos y una barra sobre la espalda alta, dentro de un rack con seguros ajustados.")],
            "Flexioná caderas y rodillas hasta sentarte suavemente en el cajón manteniendo el torso firme, sin rebotar.", "Empujá el suelo para levantarte sin tomar impulso desde el cajón.")
        add([("Split_Squat_with_Dumbbells", "Sostené una mancuerna en cada mano, adelantá un pie y apoyá el empeine del pie trasero en un banco firme.")],
            "Flexioná la rodilla y la cadera delanteras para bajar, manteniendo el torso estable y la rodilla alineada con el pie.", "Empujá con el pie delantero para subir y completá ambas piernas.")
        add([
            ("Barbell_Squat", "Colocá la barra sobre la espalda alta en un rack con seguros y separá los pies en una posición estable."),
            ("Dumbbell_Squat", "Parate con una mancuerna en cada mano a los lados y los pies aproximadamente al ancho de hombros."),
            ("Front_Barbell_Squat", "Apoyá la barra sobre la parte delantera de los hombros, mantené los codos altos y salí del rack con los pies estables."),
            ("Goblet_Squat", "Sostené una kettlebell frente al pecho por sus asas y separá los pies en una posición estable."),
            ("Bodyweight_Squat", "Parate con los pies aproximadamente al ancho de hombros y prepará el abdomen firme."),
            ("Barbell_Full_Squat", "Colocá la barra sobre la espalda alta en un rack con seguros y prepará una posición de pies estable para una sentadilla profunda."),
            ("Overhead_Squat", "Sostené la barra por encima de la cabeza con un agarre ancho, los brazos estables y los pies firmes."),
            ("Zercher_Squats", "Tomá la barra desde el rack apoyándola en los pliegues de los codos, cerca del torso, y prepará una postura estable.")
        ], "Flexioná caderas y rodillas para bajar hasta la profundidad que puedas controlar, manteniendo el torso firme y las rodillas orientadas con los pies.", "Empujá el suelo con todo el pie para volver de pie sin perder la postura.")
        add([("Hack_Squat", "Apoyá espalda y hombros en la máquina hack, colocá los pies firmes en la plataforma y sujetá los agarres.")],
            "Liberá los seguros y flexioná las rodillas hasta un recorrido cómodo, sin despegar la espalda ni los talones.", "Empujá la plataforma para subir sin bloquear las rodillas y colocá los seguros al terminar.")
        add([("Freehand_Jump_Squat", "Parate con los pies al ancho de hombros, el torso firme y espacio libre para saltar.")],
            "Bajá en sentadilla y extendé las piernas para saltar hacia arriba.", "Aterrizá suavemente flexionando caderas y rodillas; recuperá el equilibrio antes de repetir.")
        add([
            ("Barbell_Step_Ups", "Colocá la barra sobre la espalda alta y parate frente a un cajón firme de altura adecuada."),
            ("Dumbbell_Step_Ups", "Sostené una mancuerna en cada mano y parate frente a un cajón firme de altura adecuada.")
        ], "Apoyá un pie completo en el cajón y extendé esa pierna para subir sin impulsarte en exceso con la de abajo.", "Bajá con control y completá ambas piernas.")
        add([("Step-up_with_Knee_Raise", "Parate frente a un cajón firme de altura adecuada, con los pies juntos.")],
            "Subí con un pie y, al quedar de pie sobre el cajón, elevá la rodilla de la otra pierna manteniendo el equilibrio.", "Bajá con control y alterná el lado.")
        add([
            ("Barbell_Lunge", "Colocá la barra sobre la espalda alta y parate con el torso estable y espacio para dar un paso."),
            ("Dumbbell_Lunges", "Parate con una mancuerna en cada mano a los lados y el torso estable.")
        ], "Dá un paso adelante y flexioná ambas rodillas para bajar, manteniendo la rodilla delantera orientada con el pie.", "Empujá con el pie delantero para volver al inicio y completá ambas piernas.")
        add([("Barbell_Walking_Lunge", "Colocá la barra sobre la espalda alta y prepará un trayecto despejado y estable.")],
            "Dá un paso adelante y flexioná ambas rodillas manteniendo el torso erguido.", "Empujá con el pie delantero y avanzá con la otra pierna para repetir alternando los pasos.")
        return result
    }()
}
