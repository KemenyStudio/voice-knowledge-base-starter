import { NextRequest, NextResponse } from "next/server"
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"

export async function GET(
  request: NextRequest,
  { params }: { params: { evalSet: string } }
) {
  const cookieStore = cookies()
  const supabase = createServerComponentClient({ cookies: () => cookieStore })
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      console.error("Error fetching user:", error)
      return NextResponse.json({ error: "No user found" }, { status: 401 })
    }

    const evalSet = params.evalSet
    if (!evalSet) {
      return NextResponse.json(
        { error: "No chatbot ID provided" },
        { status: 400 }
      )
    }

    const feedbackData = await supabase
      .from("feedback")
      .select("question_id, is_positive")
      .eq("evaluation_set", evalSet)
      .eq("created_by", user.id)

    if (feedbackData.error) {
      console.error("Error fetching feedback data:", feedbackData.error)
      return NextResponse.json(
        { error: feedbackData.error.message },
        { status: 500 }
      )
    }

    const feedback = feedbackData.data.reduce(
      (acc: { [key: string]: number }, curr: any) => {
        const key = curr.question_id
        acc[key] = curr.is_positive
        return acc
      },
      {}
    )

    // Get feedback summary
    const summaryData = await supabase
      .from("feedback_summary")
      .select("positive, negative")
      .eq("evaluation_set", evalSet)
      .maybeSingle()

    if (summaryData.error) {
      console.error("Error fetching feedback summary data:", summaryData.error)
      return NextResponse.json(
        { error: summaryData.error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        feedback: feedback,
        summary: {
          positive: summaryData.data === null ? 0 : summaryData.data.positive,
          negative: summaryData.data === null ? 0 : summaryData.data.negative,
        },
      },
      { status: 200 }
    )
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
